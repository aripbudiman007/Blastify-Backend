import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { successResponse, errorResponse } from '../utils/response';
import * as svc from '../services/chatflow.service';

const handle = (err: any, res: Response, next: NextFunction) => {
  const codes = ['CHATFLOW_NOT_FOUND', 'DEVICE_NOT_FOUND', 'INVALID_FLOW_NODES', 'INVALID_START_NODE'];
  if (codes.includes(err.code)) {
    errorResponse(res, err.status ?? 400, err.code, err.message);
    return true;
  }
  return false;
};

export async function list(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const { deviceId } = req.query as { deviceId?: string };
    const flows = await svc.listFlows(req.user!.id, deviceId);
    successResponse(res, { flows });
  } catch (err) { next(err); }
}

export async function detail(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const flow = await svc.getFlow(req.user!.id, req.params.id);
    successResponse(res, { flow });
  } catch (err: any) { if (!handle(err, res, next)) next(err); }
}

export async function create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const flow = await svc.createFlow(req.user!.id, req.body);
    successResponse(res, { flow }, 201);
  } catch (err: any) { if (!handle(err, res, next)) next(err); }
}

export async function update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const flow = await svc.updateFlow(req.user!.id, req.params.id, req.body);
    successResponse(res, { flow });
  } catch (err: any) { if (!handle(err, res, next)) next(err); }
}

export async function remove(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    await svc.deleteFlow(req.user!.id, req.params.id);
    successResponse(res, { message: 'Chat flow deleted' });
  } catch (err: any) { if (!handle(err, res, next)) next(err); }
}

export async function sessions(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const list = await svc.listFlowSessions(req.user!.id, req.params.id);
    successResponse(res, { sessions: list });
  } catch (err: any) { if (!handle(err, res, next)) next(err); }
}
