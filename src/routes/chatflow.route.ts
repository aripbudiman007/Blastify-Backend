import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { requireFeature } from '../middleware/plan.middleware';
import * as ctrl from '../controllers/chatflow.controller';

export const chatflowRouter = Router();
chatflowRouter.use(authMiddleware, requireFeature('canAutoReply'));

const matchTypes = ['EXACT', 'CONTAINS', 'STARTS_WITH', 'REGEX', 'AI'] as const;
const idParam = { params: z.object({ id: z.string().min(1) }) };

const flowNodeSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().min(1),
    type: z.literal('message'),
    text: z.string().min(1),
    mediaUrl: z.string().url().optional(),
    next: z.string().optional(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('question'),
    text: z.string().min(1),
    saveAs: z.string().min(1),
    next: z.string().min(1),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('condition'),
    variable: z.string().min(1),
    branches: z.array(
      z.object({ matchType: z.enum(matchTypes), value: z.string(), next: z.string().min(1) }),
    ).min(1),
    default: z.string().optional(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('action'),
    action: z.string().min(1),
    params: z.record(z.string(), z.any()).optional(),
    next: z.string().optional(),
  }),
  z.object({ id: z.string().min(1), type: z.literal('end') }),
]);

const nodesSchema = z.array(flowNodeSchema).min(1).max(200);

chatflowRouter.get('/', ctrl.list);

chatflowRouter.post(
  '/',
  validate({
    body: z.object({
      deviceId: z.string().min(1),
      name: z.string().min(1).max(150),
      triggerKeyword: z.string().min(1),
      triggerMatchType: z.enum(matchTypes).default('CONTAINS'),
      startNodeId: z.string().min(1),
      nodes: nodesSchema,
    }),
  }),
  ctrl.create,
);

chatflowRouter.get('/:id', validate(idParam), ctrl.detail);
chatflowRouter.get('/:id/sessions', validate(idParam), ctrl.sessions);

chatflowRouter.put(
  '/:id',
  validate({
    ...idParam,
    body: z.object({
      name: z.string().min(1).max(150).optional(),
      triggerKeyword: z.string().min(1).optional(),
      triggerMatchType: z.enum(matchTypes).optional(),
      isActive: z.boolean().optional(),
      startNodeId: z.string().min(1).optional(),
      nodes: nodesSchema.optional(),
    }),
  }),
  ctrl.update,
);

chatflowRouter.delete('/:id', validate(idParam), ctrl.remove);
