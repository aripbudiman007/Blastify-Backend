import { Response, NextFunction } from 'express';
import { prisma } from '../../prisma/client';
import { AdminRequest } from '../../middleware/admin.middleware';
import { logAudit } from '../../utils/audit';
import { calcPlanExpiry } from '../../jobs/subscription-check.job';

export async function listUsers(req: AdminRequest, res: Response, next: NextFunction) {
  try {
    const { search, plan, page = '1', limit = '20' } = req.query as any;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {};
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (plan) where.plan = plan;

    const [total, data] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip, take: Number(limit),
        select: {
          id: true, name: true, email: true, plan: true,
          isActive: true, planExpiresAt: true, planActivatedAt: true,
          createdAt: true, updatedAt: true,
          _count: { select: { devices: true, messages: true } },
        },
      }),
    ]);

    res.json({ success: true, data: { data, total, page: Number(page), limit: Number(limit) } });
  } catch (err) { next(err); }
}

export async function getUserDetail(req: AdminRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true, name: true, email: true, plan: true, apiKey: true,
        isActive: true, planExpiresAt: true, planActivatedAt: true,
        createdAt: true, updatedAt: true,
        devices: { select: { id: true, name: true, status: true, phone: true } },
        invoices: { orderBy: { createdAt: 'desc' }, take: 10 },
        _count: { select: { messages: true, contacts: true, broadcasts: true } },
      },
    });
    if (!user) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
    res.json({ success: true, data: user });
  } catch (err) { next(err); }
}

export async function updateUserPlan(req: AdminRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { plan, expiresAt } = req.body as { plan: string; expiresAt?: string };
    const validPlans = ['FREE', 'LITE', 'REGULAR', 'MASTER', 'ULTRA'];
    if (!validPlans.includes(plan)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_PLAN' } });
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });

    const now = new Date();
    const planExpiresAt = plan === 'FREE'
      ? null
      : expiresAt
        ? new Date(expiresAt)
        : calcPlanExpiry(user.planExpiresAt);

    const updated = await prisma.user.update({
      where: { id },
      data: { plan: plan as any, planExpiresAt, planActivatedAt: plan !== 'FREE' ? now : null },
      select: { id: true, email: true, plan: true, planExpiresAt: true },
    });

    logAudit({
      actorType: 'admin', actorId: req.admin!.adminId, actorEmail: req.admin!.email,
      action: 'user.plan_changed', targetType: 'user', targetId: id,
      metadata: { from: user.plan, to: plan }, ip: req.ip,
    });

    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

export async function updateUserStatus(req: AdminRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { isActive } = req.body as { isActive: boolean };

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });

    const updated = await prisma.user.update({
      where: { id }, data: { isActive },
      select: { id: true, email: true, isActive: true },
    });

    logAudit({
      actorType: 'admin', actorId: req.admin!.adminId, actorEmail: req.admin!.email,
      action: isActive ? 'user.activated' : 'user.deactivated', targetType: 'user', targetId: id,
      ip: req.ip,
    });

    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

export async function deleteUser(req: AdminRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });

    // Stop any active WA sessions
    const { getAllSessions } = await import('../../baileys/session');
    const sessions = getAllSessions();
    const devices = await prisma.device.findMany({ where: { userId: id }, select: { id: true } });
    for (const d of devices) {
      const sock = sessions.get(d.id);
      if (sock) { try { sock.end(undefined); } catch { } sessions.delete(d.id); }
    }

    await prisma.user.delete({ where: { id } });

    logAudit({
      actorType: 'admin', actorId: req.admin!.adminId, actorEmail: req.admin!.email,
      action: 'user.deleted', targetType: 'user', targetId: id,
      metadata: { email: user.email, plan: user.plan }, ip: req.ip,
    });

    res.json({ success: true, message: 'User deleted' });
  } catch (err) { next(err); }
}
