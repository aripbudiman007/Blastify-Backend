import { Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../../prisma/client';
import { AdminRequest } from '../../middleware/admin.middleware';
import { logAudit } from '../../utils/audit';

export async function listAuditLogs(req: AdminRequest, res: Response, next: NextFunction) {
  try {
    const { actorId, action, page = '1', limit = '50', dateFrom, dateTo } = req.query as any;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {};
    if (actorId) where.actorId = actorId;
    if (action) where.action = { contains: action };
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    const [total, data] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where, orderBy: { createdAt: 'desc' }, skip, take: Number(limit),
      }),
    ]);

    res.json({ success: true, data: { data, total, page: Number(page), limit: Number(limit) } });
  } catch (err) { next(err); }
}

export async function listAdmins(req: AdminRequest, res: Response, next: NextFunction) {
  try {
    const data = await prisma.admin.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, email: true, role: true, isActive: true, lastLogin: true, createdAt: true },
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function createAdmin(req: AdminRequest, res: Response, next: NextFunction) {
  try {
    const { email, name, password, role } = req.body as {
      email: string; name: string; password: string; role?: string;
    };

    const existing = await prisma.admin.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ success: false, error: { code: 'DUPLICATE_EMAIL' } });

    const hashed = await bcrypt.hash(password, 12);
    const admin = await prisma.admin.create({
      data: { email, name, password: hashed, role: (role as any) ?? 'STAFF' },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });

    logAudit({
      actorType: 'admin', actorId: req.admin!.adminId, actorEmail: req.admin!.email,
      action: 'admin.created', targetType: 'admin', targetId: admin.id,
      metadata: { email, role }, ip: req.ip,
    });

    res.status(201).json({ success: true, data: admin });
  } catch (err) { next(err); }
}

export async function updateAdminStatus(req: AdminRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { isActive } = req.body as { isActive: boolean };

    const admin = await prisma.admin.findUnique({ where: { id } });
    if (!admin) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });

    // Protect: SUPER_ADMIN cannot be deactivated by a non-SUPER_ADMIN
    if (admin.role === 'SUPER_ADMIN' && req.admin!.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN' } });
    }

    const updated = await prisma.admin.update({
      where: { id }, data: { isActive },
      select: { id: true, email: true, isActive: true },
    });

    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}
