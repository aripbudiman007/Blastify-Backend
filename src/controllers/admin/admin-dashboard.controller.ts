import { Response, NextFunction } from 'express';
import { prisma } from '../../prisma/client';
import { AdminRequest } from '../../middleware/admin.middleware';

export async function stats(_req: AdminRequest, res: Response, next: NextFunction) {
  try {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      activeUsers30d,
      usersByPlan,
      totalDevices,
      connectedDevices,
      messagesToday,
      messagesThisMonth,
      pendingInvoices,
      newUsersToday,
      revenueThisMonth,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { updatedAt: { gte: thirtyDaysAgo }, isActive: true } }),
      prisma.user.groupBy({ by: ['plan'], _count: { plan: true } }),
      prisma.device.count(),
      prisma.device.count({ where: { status: 'CONNECTED' } }),
      prisma.message.count({ where: { createdAt: { gte: startOfDay } } }),
      prisma.message.count({ where: { createdAt: { gte: startOfMonth } } }),
      prisma.invoice.count({ where: { status: 'PENDING' } }),
      prisma.user.count({ where: { createdAt: { gte: startOfDay } } }),
      prisma.invoice.aggregate({
        _sum: { amount: true },
        where: { status: 'PAID', paidAt: { gte: startOfMonth } },
      }),
    ]);

    const planBreakdown = Object.fromEntries(
      usersByPlan.map((r) => [r.plan, r._count.plan]),
    );

    res.json({
      success: true,
      data: {
        totalUsers,
        activeUsers30d,
        usersByPlan: planBreakdown,
        totalDevices,
        connectedDevices,
        messagesToday,
        messagesThisMonth,
        revenueThisMonth: revenueThisMonth._sum.amount ?? 0,
        pendingInvoices,
        newUsersToday,
      },
    });
  } catch (err) { next(err); }
}
