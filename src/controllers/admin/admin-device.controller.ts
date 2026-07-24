import { Response, NextFunction } from 'express';
import { prisma } from '../../prisma/client';
import { AdminRequest } from '../../middleware/admin.middleware';
import { logAudit } from '../../utils/audit';

export async function listDevices(req: AdminRequest, res: Response, next: NextFunction) {
  try {
    const { status, userId, page = '1', limit = '20' } = req.query as any;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {};
    if (status) where.status = status;
    if (userId) where.userId = userId;

    const [total, data] = await Promise.all([
      prisma.device.count({ where }),
      prisma.device.findMany({
        where, orderBy: { createdAt: 'desc' }, skip, take: Number(limit),
        select: {
          id: true, name: true, phone: true, status: true, createdAt: true,
          user: { select: { id: true, name: true, email: true, plan: true } },
        },
      }),
    ]);

    res.json({ success: true, data: { data, total, page: Number(page), limit: Number(limit) } });
  } catch (err) { next(err); }
}

export async function forceDisconnectDevice(req: AdminRequest, res: Response, next: NextFunction) {
  try {
    const device = await prisma.device.findUnique({ where: { id: req.params.id } });
    if (!device) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });

    const { getAllSessions } = await import('../../baileys/session');
    const sessions = getAllSessions();
    const sock = sessions.get(device.id);
    if (sock) {
      try { sock.end(undefined); } catch { }
      sessions.delete(device.id);
    }

    await prisma.device.update({ where: { id: device.id }, data: { status: 'DISCONNECTED' } });

    logAudit({
      actorType: 'admin', actorId: req.admin!.adminId, actorEmail: req.admin!.email,
      action: 'device.force_disconnected', targetType: 'device', targetId: device.id, ip: req.ip,
    });

    res.json({ success: true, message: 'Device disconnected' });
  } catch (err) { next(err); }
}

export async function deleteDevice(req: AdminRequest, res: Response, next: NextFunction) {
  try {
    const device = await prisma.device.findUnique({ where: { id: req.params.id } });
    if (!device) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });

    const { getAllSessions } = await import('../../baileys/session');
    const sessions = getAllSessions();
    const sock = sessions.get(device.id);
    if (sock) { try { sock.end(undefined); } catch { } sessions.delete(device.id); }

    await prisma.device.delete({ where: { id: device.id } });

    logAudit({
      actorType: 'admin', actorId: req.admin!.adminId, actorEmail: req.admin!.email,
      action: 'device.deleted', targetType: 'device', targetId: device.id, ip: req.ip,
    });

    res.json({ success: true, message: 'Device deleted' });
  } catch (err) { next(err); }
}
