import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { requireFeature } from '../middleware/plan.middleware';
import { AuthenticatedRequest } from '../types';
import * as ctrl from '../controllers/autoreply.controller';

export const autoreplyRouter = Router();
autoreplyRouter.use(authMiddleware, requireFeature('canAutoReply'));

const matchTypes = ['EXACT', 'CONTAINS', 'STARTS_WITH', 'REGEX', 'AI'] as const;
const replyTypes = ['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'] as const;
const idParam = { params: z.object({ id: z.string().min(1) }) };

// matchType AI (balasan digenerate LLM) hanya untuk plan dengan canAiReply
const aiGate = requireFeature('canAiReply');
function requireAiPlanIfAiMatch(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (req.body?.matchType === 'AI') return aiGate(req, res, next);
  next();
}

autoreplyRouter.get('/', ctrl.list);

autoreplyRouter.post(
  '/',
  requireAiPlanIfAiMatch,
  validate({
    body: z.object({
      deviceId: z.string().min(1),
      name: z.string().min(1).max(100),
      keyword: z.string().min(1),
      matchType: z.enum(matchTypes).default('CONTAINS'),
      replyType: z.enum(replyTypes).default('TEXT'),
      replyContent: z.string().min(1),
      replyMediaUrl: z.string().url().optional(),
      priority: z.number().int().min(0).default(0),
    }),
  }),
  ctrl.create,
);

autoreplyRouter.put(
  '/:id',
  requireAiPlanIfAiMatch,
  validate({
    ...idParam,
    body: z.object({
      name: z.string().optional(),
      keyword: z.string().optional(),
      matchType: z.enum(matchTypes).optional(),
      replyType: z.enum(replyTypes).optional(),
      replyContent: z.string().optional(),
      replyMediaUrl: z.string().url().optional(),
      isActive: z.boolean().optional(),
      priority: z.number().int().min(0).optional(),
    }),
  }),
  ctrl.update,
);

autoreplyRouter.delete('/:id', validate(idParam), ctrl.remove);
