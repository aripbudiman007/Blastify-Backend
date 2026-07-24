import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { list, detail, create, update, remove, test } from '../controllers/email-template.controller';

export const emailTemplateRouter = Router();
emailTemplateRouter.use(authMiddleware);

const categories = ['registration', 'account', 'payment', 'notification'] as const;

const createBody = z.object({
  name: z.string().min(1).max(255),
  category: z.enum(categories).optional(),
  subject: z.string().min(1).max(255),
  htmlContent: z.string().min(1),
  plainTextContent: z.string().optional(),
});

const updateBody = z.object({
  subject: z.string().min(1).max(255).optional(),
  htmlContent: z.string().min(1).optional(),
  plainTextContent: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

const idParam = { params: z.object({ id: z.string().min(1) }) };

emailTemplateRouter.get('/', list);
emailTemplateRouter.post('/', validate({ body: createBody }), create);
emailTemplateRouter.get('/:id', validate(idParam), detail);
emailTemplateRouter.put('/:id', validate({ ...idParam, body: updateBody }), update);
emailTemplateRouter.delete('/:id', validate(idParam), remove);
emailTemplateRouter.post('/:id/test', validate({
  ...idParam,
  body: z.object({
    recipientEmail: z.string().email(),
    variables: z.record(z.string(), z.any()).optional(),
  }),
}), test);
