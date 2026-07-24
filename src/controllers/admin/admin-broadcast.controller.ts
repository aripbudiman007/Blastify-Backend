import { Response, NextFunction } from 'express';
import { prisma } from '../../prisma/client';
import { AdminRequest } from '../../middleware/admin.middleware';
import { logAudit } from '../../utils/audit';

export async function listBroadcasts(req: AdminRequest, res: Response, next: NextFunction) {
  try {
    const { status, userId, page = '1', limit = '20' } = req.query as any;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {};
    if (status) where.status = status;
    if (userId) where.userId = userId;

    const [total, data] = await Promise.all([
      prisma.broadcast.count({ where }),
      prisma.broadcast.findMany({
        where, orderBy: { createdAt: 'desc' }, skip, take: Number(limit),
        select: {
          id: true, name: true, status: true, type: true,
          totalCount: true, sentCount: true, failedCount: true,
          scheduledAt: true, startedAt: true, finishedAt: true, createdAt: true,
          user: { select: { id: true, name: true, email: true } },
        },
      }),
    ]);

    res.json({ success: true, data: { data, total, page: Number(page), limit: Number(limit) } });
  } catch (err) { next(err); }
}

export async function stopBroadcast(req: AdminRequest, res: Response, next: NextFunction) {
  try {
    const broadcast = await prisma.broadcast.findUnique({ where: { id: req.params.id } });
    if (!broadcast) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
    if (broadcast.status !== 'RUNNING') {
      return res.status(400).json({ success: false, error: { code: 'NOT_RUNNING', message: `Broadcast is ${broadcast.status}` } });
    }

    await prisma.broadcast.update({ where: { id: broadcast.id }, data: { status: 'PAUSED' } });

    logAudit({
      actorType: 'admin', actorId: req.admin!.adminId, actorEmail: req.admin!.email,
      action: 'broadcast.force_stopped', targetType: 'broadcast', targetId: broadcast.id, ip: req.ip,
    });

    res.json({ success: true, message: 'Broadcast stopped' });
  } catch (err) { next(err); }
}
