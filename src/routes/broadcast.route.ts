import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import * as ctrl from '../controllers/broadcast.controller';
import { logs, resume } from '../controllers/broadcast.controller';

export const broadcastRouter = Router();
broadcastRouter.use(authMiddleware);

const idParam = { params: z.object({ broadcastId: z.string().min(1) }) };
const msgTypes = ['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT', 'AUDIO'] as const;

broadcastRouter.get('/', ctrl.list);

broadcastRouter.post(
  '/',
  validate({
    body: z.object({
      name: z.string().min(1).max(150),
      deviceId: z.string().optional(),          // null = device rotation
      contactGroupId: z.string().optional(),
      type: z.enum(msgTypes).default('TEXT'),
      content: z.string().min(1),
      mediaUrl: z.string().url().optional(),
      caption: z.string().optional(),
      scheduledAt: z.string().datetime().optional(),
      delayMin: z.number().int().min(500).default(1000),
      delayMax: z.number().int().min(500).default(3000),
      // A/B testing (opsional) — variantBRatio > 0 mengaktifkan split test
      variantBContent: z.string().optional(),
      variantBMediaUrl: z.string().url().optional(),
      variantBCaption: z.string().optional(),
      variantBRatio: z.number().int().min(0).max(100).optional(),
    }),
  }),
  ctrl.create,
);

broadcastRouter.get('/:broadcastId', validate(idParam), ctrl.detail);
broadcastRouter.delete('/:broadcastId', validate(idParam), ctrl.remove);
broadcastRouter.post('/:broadcastId/start', validate(idParam), ctrl.start);
broadcastRouter.post('/:broadcastId/pause', validate(idParam), ctrl.pause);
broadcastRouter.post('/:broadcastId/resume', validate(idParam), resume);
broadcastRouter.get('/:broadcastId/logs', validate(idParam), logs);
broadcastRouter.get('/:broadcastId/analytics', validate(idParam), ctrl.analytics);
broadcastRouter.get('/:broadcastId/variants', validate(idParam), ctrl.variants);
