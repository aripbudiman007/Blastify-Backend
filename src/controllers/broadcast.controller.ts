import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { successResponse, errorResponse, parsePagination, paginationMeta } from '../utils/response';
import * as svc from '../services/broadcast.service';

const handle = (err: any, res: Response, next: NextFunction) => {
  const codes = ['BROADCAST_NOT_FOUND', 'BROADCAST_RUNNING', 'BROADCAST_INVALID_STATE', 'NO_RECIPIENTS'];
  if (codes.includes(err.code)) {
    errorResponse(res, err.status ?? 400, err.code, err.message); return true;
  }
  return false;
};

export async function list(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit } = parsePagination(req.query);
    const result = await svc.listBroadcasts(req.user!.id, page, limit);
    successResponse(res, { broadcasts: result.broadcasts }, 200, paginationMeta(page, limit, result.total));
  } catch (err) { next(err); }
}

export async function create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const broadcast = await svc.createBroadcast(req.user!.id, {
      ...req.body,
      scheduledAt: req.body.scheduledAt ? new Date(req.body.scheduledAt) : undefined,
    });
    successResponse(res, { broadcast }, 201);
  } catch (err) { next(err); }
}

export async function detail(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const broadcast = await svc.getBroadcast(req.user!.id, req.params.broadcastId);
    successResponse(res, { broadcast });
  } catch (err: any) { if (!handle(err, res, next)) next(err); }
}

/**
 * Analytics per campaign: breakdown status pesan, delivery rate, read rate
 * (read rate = "open rate" versi WhatsApp — hanya terhitung jika penerima
 * tidak mematikan centang biru), dan timeline pengiriman per jam.
 */
export async function analytics(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const { prisma } = await import('../prisma/client');
    const broadcast = await svc.getBroadcast(req.user!.id, req.params.broadcastId);

    const [byStatus, timeline] = await Promise.all([
      prisma.message.groupBy({
        by: ['status'],
        where: { broadcastId: broadcast.id },
        _count: true,
      }),
      prisma.$queryRaw<Array<{ hour: string; sent: bigint }>>`
        SELECT to_char("sentAt", 'YYYY-MM-DD HH24:00') AS hour, COUNT(*)::bigint AS sent
        FROM "Message"
        WHERE "broadcastId" = ${broadcast.id} AND "sentAt" IS NOT NULL
        GROUP BY 1 ORDER BY 1
      `,
    ]);

    const counts: Record<string, number> = {};
    for (const s of byStatus) counts[s.status] = s._count;

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const delivered = (counts.DELIVERED ?? 0) + (counts.READ ?? 0);
    const sentPlus = (counts.SENT ?? 0) + delivered;
    const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

    successResponse(res, {
      broadcastId: broadcast.id,
      name: broadcast.name,
      status: broadcast.status,
      total,
      byStatus: counts,
      rates: {
        sentRate: pct(sentPlus, total),
        deliveryRate: pct(delivered, sentPlus),
        readRate: pct(counts.READ ?? 0, delivered),
        failRate: pct(counts.FAILED ?? 0, total),
      },
      timeline: timeline.map((t) => ({ hour: t.hour, sent: Number(t.sent) })),
    });
  } catch (err: any) { if (!handle(err, res, next)) next(err); }
}

export async function remove(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    await svc.deleteBroadcast(req.user!.id, req.params.broadcastId);
    successResponse(res, { message: 'Broadcast deleted' });
  } catch (err: any) { if (!handle(err, res, next)) next(err); }
}

export async function start(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    await svc.startBroadcast(req.user!.id, req.params.broadcastId);
    successResponse(res, { message: 'Broadcast started. Messages are being queued.' });
  } catch (err: any) { if (!handle(err, res, next)) next(err); }
}

export async function pause(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const broadcast = await svc.pauseBroadcast(req.user!.id, req.params.broadcastId);
    successResponse(res, { broadcast });
  } catch (err: any) { if (!handle(err, res, next)) next(err); }
}

export async function resume(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    await svc.resumeBroadcast(req.user!.id, req.params.broadcastId);
    successResponse(res, { message: 'Broadcast resumed. Messages are being queued.' });
  } catch (err: any) { if (!handle(err, res, next)) next(err); }
}

export async function logs(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit } = parsePagination(req.query);
    const { status } = req.query as { status?: string };
    const result = await svc.getBroadcastLogs(req.user!.id, req.params.broadcastId, page, limit, status);
    successResponse(res, { logs: result.messages }, 200, paginationMeta(page, limit, result.total));
  } catch (err: any) { if (!handle(err, res, next)) next(err); }
}

/** A/B testing breakdown: per-variant sent/delivered/read/failed counts. */
export async function variants(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const stats = await svc.getBroadcastVariantStats(req.user!.id, req.params.broadcastId);
    successResponse(res, stats);
  } catch (err: any) { if (!handle(err, res, next)) next(err); }
}
