import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../prisma/client';
import { config } from '../../config';
import { logAudit } from '../../utils/audit';
import { AdminRequest } from '../../middleware/admin.middleware';

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body as { email: string; password: string };

    const admin = await prisma.admin.findUnique({ where: { email } });
    if (!admin || !admin.isActive) {
      return res.status(401).json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
    }

    const valid = await bcrypt.compare(password, admin.password);
    if (!valid) {
      return res.status(401).json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
    }

    await prisma.admin.update({ where: { id: admin.id }, data: { lastLogin: new Date() } });

    const token = jwt.sign(
      { adminId: admin.id, role: admin.role, email: admin.email },
      config.ADMIN_JWT_SECRET,
      { expiresIn: config.ADMIN_JWT_EXPIRES_IN } as any,
    );

    logAudit({
      actorType: 'admin', actorId: admin.id, actorEmail: admin.email,
      action: 'admin.login', ip: req.ip,
    });

    res.json({
      success: true,
      data: {
        token,
        admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
      },
    });
  } catch (err) { next(err); }
}

export async function me(req: AdminRequest, res: Response, next: NextFunction) {
  try {
    const admin = await prisma.admin.findUnique({
      where: { id: req.admin!.adminId },
      select: { id: true, name: true, email: true, role: true, lastLogin: true, createdAt: true },
    });
    if (!admin) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
    res.json({ success: true, data: admin });
  } catch (err) { next(err); }
}
