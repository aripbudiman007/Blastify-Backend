import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { list, conversations, conversation, readOne, readAll, remove, react, reply } from '../controllers/inbox.controller';

export const inboxRouter = Router();
inboxRouter.use(authMiddleware);

inboxRouter.get('/', list);
inboxRouter.get('/conversations', conversations);
inboxRouter.put('/read-all', readAll);
inboxRouter.put('/:id/read', readOne);

// Reaksi emoji ke pesan masuk (emoji "" = hapus reaksi)
inboxRouter.post(
  '/:id/reaction',
  validate({
    params: z.object({ id: z.string().min(1) }),
    body: z.object({ emoji: z.string().max(8) }),
  }),
  react,
);

// Balas pesan masuk dengan quote (reply bubble)
inboxRouter.post(
  '/:id/reply',
  validate({
    params: z.object({ id: z.string().min(1) }),
    body: z.object({ message: z.string().min(1).max(4096) }),
  }),
  reply,
);

inboxRouter.delete('/:id', remove);
inboxRouter.get('/:from', conversation);
