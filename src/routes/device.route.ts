import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import {
  list, create, detail, remove, connect, disconnect, qrCode, pairingCode,
  settings, listAgents, addAgent, updateAgent, deleteAgent,
  waGroups, waGroupMembers, importGroupContacts,
} from '../controllers/device.controller';

export const deviceRouter = Router();
deviceRouter.use(authMiddleware);

const deviceIdSchema = { params: z.object({ deviceId: z.string().min(1) }) };
const agentParamsSchema = { params: z.object({ deviceId: z.string().min(1), agentId: z.string().min(1) }) };

const agentRoles = ['OWNER', 'AGENT', 'VIEWER'] as const;

// ─── Core device CRUD & connection ───────────────────────────────────────────
deviceRouter.get('/', list);
deviceRouter.post('/', validate({ body: z.object({ name: z.string().min(1).max(100) }) }), create);
deviceRouter.get('/:deviceId', validate(deviceIdSchema), detail);
deviceRouter.delete('/:deviceId', validate(deviceIdSchema), remove);
deviceRouter.post('/:deviceId/connect', validate(deviceIdSchema), connect);
deviceRouter.post('/:deviceId/disconnect', validate(deviceIdSchema), disconnect);
deviceRouter.get('/:deviceId/qr', validate(deviceIdSchema), qrCode);
deviceRouter.post(
  '/:deviceId/pairing-code',
  validate({
    params: z.object({ deviceId: z.string().min(1) }),
    body: z.object({ phone: z.string().min(7) }),
  }),
  pairingCode,
);

// ─── Device settings (delay, working hours, bad words, auto-save) ────────────
deviceRouter.patch(
  '/:deviceId/settings',
  validate({
    params: z.object({ deviceId: z.string().min(1) }),
    body: z.object({
      name: z.string().min(1).max(100).optional(),
      minDelay: z.number().int().min(0).max(60000).optional(),
      maxDelay: z.number().int().min(0).max(60000).optional(),
      workingHoursStart: z.number().int().min(0).max(23).nullable().optional(),
      workingHoursEnd: z.number().int().min(0).max(23).nullable().optional(),
      workingDays: z.array(z.number().int().min(0).max(6)).optional(),
      badWordsEnabled: z.boolean().optional(),
      badWords: z.array(z.string()).optional(),
      autoSaveContacts: z.boolean().optional(),
      typingIndicator: z.boolean().optional(),
      readReceiptSimulation: z.boolean().optional(),
      warmupEnabled: z.boolean().optional(),
    }),
  }),
  settings,
);

// ─── WhatsApp Groups (Grab Contacts) ─────────────────────────────────────────
deviceRouter.get('/:deviceId/wa-groups', validate(deviceIdSchema), waGroups);

deviceRouter.get(
  '/:deviceId/wa-groups/:groupJid/members',
  validate({ params: z.object({ deviceId: z.string().min(1), groupJid: z.string().min(1) }) }),
  waGroupMembers,
);

deviceRouter.post(
  '/:deviceId/wa-groups/:groupJid/import',
  validate({
    params: z.object({ deviceId: z.string().min(1), groupJid: z.string().min(1) }),
    body: z.object({ contactGroupId: z.string().optional() }),
  }),
  importGroupContacts,
);

// ─── Multi-agent management ───────────────────────────────────────────────────
deviceRouter.get('/:deviceId/agents', validate(deviceIdSchema), listAgents);

deviceRouter.post(
  '/:deviceId/agents',
  validate({
    params: z.object({ deviceId: z.string().min(1) }),
    body: z.object({
      email: z.string().email(),
      role: z.enum(agentRoles).optional().default('AGENT'),
    }),
  }),
  addAgent,
);

deviceRouter.patch(
  '/:deviceId/agents/:agentId',
  validate({
    ...agentParamsSchema,
    body: z.object({ role: z.enum(agentRoles) }),
  }),
  updateAgent,
);

deviceRouter.delete('/:deviceId/agents/:agentId', validate(agentParamsSchema), deleteAgent);
