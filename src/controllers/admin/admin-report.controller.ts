import { Response, NextFunction } from 'express';
import { prisma } from '../../prisma/client';
import { AdminRequest } from '../../middleware/admin.middleware';

/**
 * GET /admin/reports/revenue?months=12
 * Revenue analytics dari tabel Invoice (amount dalam sen IDR).
 */
export async function revenueReport(req: AdminRequest, res: Response, next: NextFunction) {
  try {
    const months = Math.min(24, Math.max(1, Number(req.query.months) || 12));
    const since = new Date();
    since.setMonth(since.getMonth() - (months - 1));
    since.setDate(1);
    since.setHours(0, 0, 0, 0);

    const [monthlyRaw, byPlan, byMethod, totals, activeSubscribers, recentPayments] =
      await Promise.all([
        // Revenue per bulan
        prisma.$queryRaw<Array<{ month: string; revenue: bigint; count: bigint }>>`
          SELECT to_char("paidAt", 'YYYY-MM') AS month,
                 SUM("amount")::bigint AS revenue,
                 COUNT(*)::bigint AS count
          FROM "Invoice"
          WHERE "status" = 'PAID' AND "paidAt" >= ${since}
          GROUP BY 1 ORDER BY 1
        `,
        // Revenue per plan (sepanjang periode)
        prisma.invoice.groupBy({
          by: ['plan'],
          where: { status: 'PAID', paidAt: { gte: since } },
          _sum: { amount: true },
          _count: true,
        }),
        // Revenue per metode pembayaran
        prisma.invoice.groupBy({
          by: ['paymentMethod'],
          where: { status: 'PAID', paidAt: { gte: since } },
          _sum: { amount: true },
          _count: true,
        }),
        // Total sepanjang masa
        prisma.invoice.aggregate({
          where: { status: 'PAID' },
          _sum: { amount: true },
          _count: true,
        }),
        // Subscriber berbayar aktif per plan → basis MRR
        prisma.user.groupBy({
          by: ['plan'],
          where: {
            plan: { not: 'FREE' },
            isActive: true,
            OR: [{ planExpiresAt: null }, { planExpiresAt: { gte: new Date() } }],
          },
          _count: true,
        }),
        prisma.invoice.findMany({
          where: { status: 'PAID' },
          orderBy: { paidAt: 'desc' },
          take: 10,
          include: { user: { select: { id: true, name: true, email: true } } },
        }),
      ]);

    // MRR = jumlah subscriber aktif × harga plan bulanan (dari tabel PlanLimit)
    const { getPlanPrice } = await import('../../middleware/plan.middleware');
    const mrrByPlan = await Promise.all(
      activeSubscribers.map(async (s) => ({
        plan: s.plan,
        subscribers: s._count,
        mrr: (await getPlanPrice(s.plan)) * s._count,
      })),
    );
    const mrr = mrrByPlan.reduce((sum, p) => sum + p.mrr, 0);

    res.json({
      success: true,
      data: {
        currency: 'IDR (sen)',
        mrr,
        mrrByPlan,
        monthly: monthlyRaw.map((m) => ({
          month: m.month,
          revenue: Number(m.revenue),
          invoices: Number(m.count),
        })),
        byPlan: byPlan.map((p) => ({ plan: p.plan, revenue: p._sum.amount ?? 0, invoices: p._count })),
        byPaymentMethod: byMethod.map((p) => ({
          method: p.paymentMethod ?? 'manual/unknown',
          revenue: p._sum.amount ?? 0,
          invoices: p._count,
        })),
        allTime: { revenue: totals._sum.amount ?? 0, invoices: totals._count },
        recentPayments,
      },
    });
  } catch (err) { next(err); }
}
