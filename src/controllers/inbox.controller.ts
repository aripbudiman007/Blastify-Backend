import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import {
  listInbox, listConversations, getConversation,
  markAsRead, markAllRead, deleteIncoming,
} from '../services/inbox.service';
import { reactToIncoming, replyToIncoming } from '../services/wa-action.service';
import { errorResponse } from '../utils/response';

function handleWaActionError(err: any, res: Response, next: NextFunction) {
  if (['MESSAGE_NOT_FOUND', 'NO_WA_MESSAGE_ID', 'SESSION_NOT_ACTIVE'].includes(err.code)) {
    errorResponse(res, err.status, err.code, err.message);
    return;
  }
  next(err);
}

export async function react(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const data = await reactToIncoming(req.user!.id, req.params.id, req.body.emoji);
    res.json({ success: true, data });
  } catch (err: any) { handleWaActionError(err, res, next); }
}

export async function reply(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const data = await replyToIncoming(req.user!.id, req.params.id, req.body.message);
    res.json({ success: true, data });
  } catch (err: any) { handleWaActionError(err, res, next); }
}

export async function list(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const { deviceId, from, isRead, isGroup, dateFrom, dateTo, page, limit } = req.query as any;

    const result = await listInbox(userId, {
      deviceId,
      from,
      isRead: isRead !== undefined ? isRead === 'true' : undefined,
      isGroup: isGroup !== undefined ? isGroup === 'true' : undefined,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      page: page ? Number(page) : 1,
      limit: Math.min(Number(limit ?? 30), 100),
    });

    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function conversations(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const { deviceId } = req.query as any;
    const data = await listConversations(userId, deviceId);
    res.json({ success: true, data: { conversations: data } });
  } catch (err) { next(err); }
}

export async function conversation(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const { from } = req.params;
    const { deviceId } = req.query as any;
    const data = await getConversation(userId, from, deviceId);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function readOne(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const data = await markAsRead(userId, req.params.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function readAll(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const { deviceId } = req.query as any;
    const data = await markAllRead(userId, deviceId);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function remove(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    await deleteIncoming(userId, req.params.id);
    res.json({ success: true, message: 'Message deleted' });
  } catch (err) { next(err); }
}
