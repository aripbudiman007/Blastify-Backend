import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { requireFeature } from '../middleware/plan.middleware';
import { list, create, update, remove, test } from '../controllers/webhook.controller';

export const webhookRouter = Router();

webhookRouter.use(authMiddleware);

const validEvents = [
  'message.received',
  'message.sent',
  'message.delivered',
  'message.read',
  'device.connected',
  'device.disconnected',
  'device.qr',
] as const;

const webhookIdSchema = { params: z.object({ webhookId: z.string().min(1) }) };

webhookRouter.get('/', list);

webhookRouter.post(
  '/',
  requireFeature('canWebhook'),
  validate({
    body: z.object({
      url: z.string().url(),
      events: z.array(z.enum(validEvents)).min(1),
      deviceIds: z.array(z.string()).optional(),
    }),
  }),
  create,
);

webhookRouter.put(
  '/:webhookId',
  validate({
    ...webhookIdSchema,
    body: z.object({
      url: z.string().url().optional(),
      events: z.array(z.enum(validEvents)).optional(),
      isActive: z.boolean().optional(),
      deviceIds: z.array(z.string()).optional(),
    }),
  }),
  update,
);

webhookRouter.delete('/:webhookId', validate(webhookIdSchema), remove);

webhookRouter.post('/:webhookId/test', validate(webhookIdSchema), test);
