import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../prisma/client';
import { AdminRequest } from '../../middleware/admin.middleware';
import { logAudit } from '../../utils/audit';

// ─── Admin CRUD ───────────────────────────────────────────────────────────────

export async function listAnnouncements(req: AdminRequest, res: Response, next: NextFunction) {
  try {
    const data = await prisma.announcement.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function createAnnouncement(req: AdminRequest, res: Response, next: NextFunction) {
  try {
    const { title, content, type, isActive, startsAt, endsAt, targetPlan } = req.body;
    const data = await prisma.announcement.create({
      data: {
        title, content,
        type: type ?? 'INFO',
        isActive: isActive ?? true,
        startsAt: startsAt ? new Date(startsAt) : null,
        endsAt: endsAt ? new Date(endsAt) : null,
        targetPlan: targetPlan ?? [],
        createdBy: req.admin!.adminId,
      },
    });

    logAudit({
      actorType: 'admin', actorId: req.admin!.adminId, actorEmail: req.admin!.email,
      action: 'announcement.created', targetType: 'announcement', targetId: data.id, ip: req.ip,
    });

    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
}

export async function updateAnnouncement(req: AdminRequest, res: Response, next: NextFunction) {
  try {
    const announcement = await prisma.announcement.findUnique({ where: { id: req.params.id } });
    if (!announcement) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });

    const { title, content, type, isActive, startsAt, endsAt, targetPlan } = req.body;
    const data = await prisma.announcement.update({
      where: { id: req.params.id },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(content !== undefined ? { content } : {}),
        ...(type !== undefined ? { type } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
        ...(startsAt !== undefined ? { startsAt: startsAt ? new Date(startsAt) : null } : {}),
        ...(endsAt !== undefined ? { endsAt: endsAt ? new Date(endsAt) : null } : {}),
        ...(targetPlan !== undefined ? { targetPlan } : {}),
      },
    });

    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function deleteAnnouncement(req: AdminRequest, res: Response, next: NextFunction) {
  try {
    const announcement = await prisma.announcement.findUnique({ where: { id: req.params.id } });
    if (!announcement) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });

    await prisma.announcement.delete({ where: { id: req.params.id } });

    logAudit({
      actorType: 'admin', actorId: req.admin!.adminId, actorEmail: req.admin!.email,
      action: 'announcement.deleted', targetType: 'announcement', targetId: req.params.id, ip: req.ip,
    });

    res.json({ success: true, message: 'Announcement deleted' });
  } catch (err) { next(err); }
}

// ─── Public endpoint — no auth ────────────────────────────────────────────────

export async function activeAnnouncements(req: Request, res: Response, next: NextFunction) {
  try {
    const now = new Date();

    const data = await prisma.announcement.findMany({
      where: {
        isActive: true,
        OR: [{ startsAt: null }, { startsAt: { lte: now } }],
        AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, title: true, content: true, type: true, targetPlan: true, startsAt: true, endsAt: true },
    });

    res.json({ success: true, data });
  } catch (err) { next(err); }
}
