import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { successResponse, errorResponse, parsePagination, paginationMeta } from '../utils/response';
import {
  sendMessage,
  sendBulkMessages,
  listMessages,
  getMessageDetail,
  listScheduledMessages,
  cancelMessage,
} from '../services/message.service';
import { revokeMessage } from '../services/wa-action.service';
import { MessageType } from '@prisma/client';

export async function revoke(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await revokeMessage(req.user!.id, req.params.messageId);
    successResponse(res, { ...data, message: 'Message deleted for everyone' });
  } catch (err: any) {
    if (['MESSAGE_NOT_FOUND', 'NOT_SENT', 'SESSION_NOT_ACTIVE'].includes(err.code)) {
      errorResponse(res, err.status, err.code, err.message);
      return;
    }
    next(err);
  }
}

export async function send(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { deviceId, to, type, message, url, caption, scheduledAt, latitude, longitude, linkPreview } = req.body;
    const result = await sendMessage(req.user!.id, {
      deviceId,
      to,
      type: type.toUpperCase() as MessageType,
      message,
      url,
      caption,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
      latitude,
      longitude,
      linkPreview,
    });
    successResponse(res, { message: result }, 201);
  } catch (err: any) {
    if (err.code === 'DEVICE_NOT_FOUND') {
      errorResponse(res, 404, 'DEVICE_NOT_FOUND', err.message);
      return;
    }
    if (err.code === 'DEVICE_NOT_CONNECTED') {
      errorResponse(res, 400, 'DEVICE_NOT_CONNECTED', err.message);
      return;
    }
    next(err);
  }
}

export async function sendBulk(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { deviceId, recipients, type, message, url, caption } = req.body;
    const inputs = (recipients as string[]).map((to) => ({
      deviceId,
      to,
      type: (type as string).toUpperCase() as MessageType,
      message,
      url,
      caption,
    }));

    const results = await sendBulkMessages(req.user!.id, inputs);
    successResponse(res, { results }, 201);
  } catch (err) {
    next(err);
  }
}

export async function list(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const { deviceId, status, from, to } = req.query as Record<string, string>;

    const result = await listMessages(req.user!.id, {
      deviceId,
      status,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      page,
      limit,
    });

    successResponse(res, { messages: result.messages }, 200, paginationMeta(page, limit, result.total));
  } catch (err) {
    next(err);
  }
}

export async function detail(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const message = await getMessageDetail(req.user!.id, req.params.messageId as string);
    successResponse(res, { message });
  } catch (err: any) {
    if (err.code === 'MESSAGE_NOT_FOUND') {
      errorResponse(res, 404, 'MESSAGE_NOT_FOUND', err.message);
      return;
    }
    next(err);
  }
}

export async function scheduled(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { deviceId } = req.query as Record<string, string>;
    const messages = await listScheduledMessages(req.user!.id, deviceId);
    successResponse(res, { messages });
  } catch (err) {
    next(err);
  }
}

export async function cancel(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const message = await cancelMessage(req.user!.id, req.params.messageId as string);
    successResponse(res, { message });
  } catch (err: any) {
    if (err.code === 'MESSAGE_NOT_FOUND') {
      errorResponse(res, 404, 'MESSAGE_NOT_FOUND', err.message);
      return;
    }
    if (err.code === 'CANNOT_CANCEL') {
      errorResponse(res, 400, 'CANNOT_CANCEL', err.message);
      return;
    }
    next(err);
  }
}
