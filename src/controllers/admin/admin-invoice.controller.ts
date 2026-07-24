import { Response, NextFunction } from 'express';
import { prisma } from '../../prisma/client';
import { AdminRequest } from '../../middleware/admin.middleware';
import { logAudit } from '../../utils/audit';
import { calcPlanExpiry } from '../../jobs/subscription-check.job';

export async function listInvoices(req: AdminRequest, res: Response, next: NextFunction) {
  try {
    const { status, plan, page = '1', limit = '20', dateFrom, dateTo } = req.query as any;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {};
    if (status) where.status = status;
    if (plan) where.plan = plan;
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    const [total, data] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.findMany({
        where, orderBy: { createdAt: 'desc' }, skip, take: Number(limit),
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
    ]);

    res.json({ success: true, data: { data, total, page: Number(page), limit: Number(limit) } });
  } catch (err) { next(err); }
}

export async function getInvoice(req: AdminRequest, res: Response, next: NextFunction) {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: { user: { select: { id: true, name: true, email: true, plan: true, planExpiresAt: true } } },
    });
    if (!invoice) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
    res.json({ success: true, data: invoice });
  } catch (err) { next(err); }
}

export async function confirmInvoice(req: AdminRequest, res: Response, next: NextFunction) {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: { user: true },
    });
    if (!invoice) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
    if (invoice.status !== 'PENDING') {
      return res.status(400).json({ success: false, error: { code: 'INVOICE_NOT_PENDING', message: `Invoice is ${invoice.status}` } });
    }

    const now = new Date();
    const planExpiresAt = calcPlanExpiry(invoice.user.planExpiresAt);

    await prisma.$transaction([
      prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: 'PAID', paidAt: now },
      }),
      prisma.user.update({
        where: { id: invoice.userId },
        data: { plan: invoice.plan as any, planActivatedAt: now, planExpiresAt },
      }),
    ]);

    logAudit({
      actorType: 'admin', actorId: req.admin!.adminId, actorEmail: req.admin!.email,
      action: 'invoice.confirmed', targetType: 'invoice', targetId: invoice.id,
      metadata: { userId: invoice.userId, plan: invoice.plan, amount: invoice.amount }, ip: req.ip,
    });

    const { sendInvoicePaidEmail } = await import('../../services/email.service');
    void sendInvoicePaidEmail(
      invoice.user.email, invoice.user.name, invoice.id, invoice.plan, invoice.amount, planExpiresAt, invoice.userId,
    );

    res.json({ success: true, data: { invoiceId: invoice.id, plan: invoice.plan, planExpiresAt } });
  } catch (err) { next(err); }
}

export async function cancelInvoice(req: AdminRequest, res: Response, next: NextFunction) {
  try {
    const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id } });
    if (!invoice) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
    if (invoice.status !== 'PENDING') {
      return res.status(400).json({ success: false, error: { code: 'INVOICE_NOT_PENDING' } });
    }

    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'CANCELLED' } });

    logAudit({
      actorType: 'admin', actorId: req.admin!.adminId, actorEmail: req.admin!.email,
      action: 'invoice.cancelled', targetType: 'invoice', targetId: invoice.id, ip: req.ip,
    });

    res.json({ success: true, message: 'Invoice cancelled' });
  } catch (err) { next(err); }
}
