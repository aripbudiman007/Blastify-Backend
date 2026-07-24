import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { successResponse, errorResponse } from '../utils/response';
import {
  listWebhooks,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  testWebhook,
} from '../services/webhook.service';

export async function list(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const webhooks = await listWebhooks(req.user!.id);
    successResponse(res, { webhooks });
  } catch (err) {
    next(err);
  }
}

export async function create(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const webhook = await createWebhook(req.user!.id, req.body);
    successResponse(res, { webhook }, 201);
  } catch (err) {
    next(err);
  }
}

export async function update(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const webhook = await updateWebhook(req.user!.id, req.params.webhookId, req.body);
    successResponse(res, { webhook });
  } catch (err: any) {
    if (err.code === 'WEBHOOK_NOT_FOUND') {
      errorResponse(res, 404, 'WEBHOOK_NOT_FOUND', err.message);
      return;
    }
    next(err);
  }
}

export async function remove(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await deleteWebhook(req.user!.id, req.params.webhookId);
    successResponse(res, { message: 'Webhook deleted successfully' });
  } catch (err: any) {
    if (err.code === 'WEBHOOK_NOT_FOUND') {
      errorResponse(res, 404, 'WEBHOOK_NOT_FOUND', err.message);
      return;
    }
    next(err);
  }
}

export async function test(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const success = await testWebhook(req.user!.id, req.params.webhookId);
    successResponse(res, {
      success,
      message: success ? 'Test payload delivered' : 'Test payload delivery failed',
    });
  } catch (err: any) {
    if (err.code === 'WEBHOOK_NOT_FOUND') {
      errorResponse(res, 404, 'WEBHOOK_NOT_FOUND', err.message);
      return;
    }
    next(err);
  }
}
