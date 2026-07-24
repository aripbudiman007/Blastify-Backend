import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { list, detail, create, update, remove, use } from '../controllers/template.controller';

export const templateRouter = Router();
templateRouter.use(authMiddleware);

const msgTypes = ['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT', 'AUDIO', 'TEMPLATE'] as const;
const categories = ['general', 'greeting', 'promo', 'notification'] as const;

const createBody = z.object({
  name: z.string().min(1).max(100),
  category: z.enum(categories).optional().default('general'),
  type: z.enum(msgTypes).optional().default('TEXT'),
  content: z.string().min(1),
  mediaUrl: z.string().url().optional(),
  caption: z.string().optional(),
});

const updateBody = z.object({
  name: z.string().min(1).max(100).optional(),
  category: z.enum(categories).optional(),
  type: z.enum(msgTypes).optional(),
  content: z.string().min(1).optional(),
  mediaUrl: z.string().url().nullable().optional(),
  caption: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

const idParam = { params: z.object({ id: z.string().min(1) }) };

templateRouter.get('/', list);
templateRouter.post('/', validate({ body: createBody }), create);
templateRouter.get('/:id', validate(idParam), detail);
templateRouter.put('/:id', validate({ ...idParam, body: updateBody }), update);
templateRouter.delete('/:id', validate(idParam), remove);
templateRouter.post('/:id/use', validate({
  ...idParam,
  body: z.object({ vars: z.record(z.string(), z.string()).optional() }),
}), use);
