import { Response, NextFunction } from 'express';
import { Plan } from '@prisma/client';
import { prisma } from '../../prisma/client';
import { AdminRequest } from '../../middleware/admin.middleware';
import { logAudit } from '../../utils/audit';

const PLAN_ORDER: Plan[] = ['FREE', 'LITE', 'REGULAR', 'MASTER', 'ULTRA'];

export async function listPlanLimits(_req: AdminRequest, res: Response, next: NextFunction) {
  try {
    const rows = await prisma.planLimit.findMany();
    const byPlan = new Map(rows.map((r) => [r.plan, r]));
    res.json({
      success: true,
      data: { plans: PLAN_ORDER.map((p) => byPlan.get(p) ?? { plan: p, seeded: false }) },
    });
  } catch (err) { next(err); }
}

/**
 * PUT /admin/plans/:plan — update limit & harga sebuah plan.
 * Berlaku langsung ke semua user (getPlanLimits membaca DB per request).
 */
export async function updatePlanLimit(req: AdminRequest, res: Response, next: NextFunction) {
  try {
    const plan = req.params.plan as Plan;

    const updated = await prisma.planLimit.upsert({
      where: { plan },
      update: req.body,
      create: { plan, ...req.body },
    });

    logAudit({
      actorType: 'admin', actorId: req.admin!.adminId, actorEmail: req.admin!.email,
      action: 'plan.limits_updated', targetType: 'planLimit', targetId: plan,
      metadata: req.body, ip: req.ip,
    });

    // Sinkronkan cache watermark bila hasWatermark ikut berubah
    const { refreshWatermarkPlans } = await import('../../utils/watermark');
    void refreshWatermarkPlans();

    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}
