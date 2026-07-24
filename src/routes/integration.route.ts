import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import {
  list, detail, create, update, remove, rotateToken, logs,
  receive, platformList, platformPreset,
} from '../controllers/integration.controller';

export const integrationRouter = Router();

// ─── Public: Platform presets (no auth needed) ───────────────────────────────
integrationRouter.get('/platforms', platformList);
integrationRouter.get('/platforms/:platform', platformPreset);

// ─── Public: Webhook receiver — NO auth, token is embedded in URL ─────────────
// IMPORTANT: must be defined BEFORE authMiddleware
integrationRouter.post('/receive/:secretToken', receive);

// ─── All routes below require authentication ─────────────────────────────────
integrationRouter.use(authMiddleware);

const idSchema = { params: z.object({ integrationId: z.string().min(1) }) };

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  platform: z.string().min(1).max(50).optional().default('generic'),
  deviceId: z.string().min(1),
  phoneField: z.string().optional(),
  targetPhone: z.string().optional(),
  messageTemplate: z.string().min(1),
  filterField: z.string().optional(),
  filterValue: z.string().optional(),
  signatureHeader: z.string().max(100).optional(),
  signatureSecret: z.string().max(255).optional(),
}).refine(
  (d) => !!(d.phoneField || d.targetPhone),
  { message: 'Either phoneField or targetPhone is required', path: ['phoneField'] },
);

const updateBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  platform: z.string().min(1).max(50).optional(),
  deviceId: z.string().min(1).optional(),
  phoneField: z.string().nullable().optional(),
  targetPhone: z.string().nullable().optional(),
  messageTemplate: z.string().min(1).optional(),
  filterField: z.string().nullable().optional(),
  filterValue: z.string().nullable().optional(),
  signatureHeader: z.string().max(100).nullable().optional(),
  signatureSecret: z.string().max(255).nullable().optional(),
  isActive: z.boolean().optional(),
});

integrationRouter.get('/', list);
integrationRouter.post('/', validate({ body: bodySchema }), create);
integrationRouter.get('/:integrationId', validate(idSchema), detail);
integrationRouter.patch('/:integrationId', validate({ ...idSchema, body: updateBodySchema }), update);
integrationRouter.delete('/:integrationId', validate(idSchema), remove);
integrationRouter.post('/:integrationId/rotate-token', validate(idSchema), rotateToken);
integrationRouter.get('/:integrationId/logs', validate(idSchema), logs);
