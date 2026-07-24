import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { successResponse, errorResponse } from '../utils/response';
import * as svc from '../services/autoreply.service';

const handle = (err: any, res: Response, next: NextFunction) => {
  if (['AUTOREPLY_NOT_FOUND', 'DEVICE_NOT_FOUND'].includes(err.code)) {
    errorResponse(res, 404, err.code, err.message); return true;
  }
  return false;
};

export async function list(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const { deviceId } = req.query as { deviceId?: string };
    const rules = await svc.listAutoReplies(req.user!.id, deviceId);
    successResponse(res, { autoReplies: rules });
  } catch (err) { next(err); }
}

export async function create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const rule = await svc.createAutoReply(req.user!.id, req.body);
    successResponse(res, { autoReply: rule }, 201);
  } catch (err: any) { if (!handle(err, res, next)) next(err); }
}

export async function update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const rule = await svc.updateAutoReply(req.user!.id, req.params.id, req.body);
    successResponse(res, { autoReply: rule });
  } catch (err: any) { if (!handle(err, res, next)) next(err); }
}

export async function remove(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    await svc.deleteAutoReply(req.user!.id, req.params.id);
    successResponse(res, { message: 'Auto-reply deleted' });
  } catch (err: any) { if (!handle(err, res, next)) next(err); }
}
