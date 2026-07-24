import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { authMiddleware } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { requireFeature } from '../middleware/plan.middleware';
import * as ctrl from '../controllers/contact.controller';

export const contactRouter = Router();
contactRouter.use(authMiddleware);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const idParam = { params: z.object({ contactId: z.string().min(1) }) };
const groupParam = { params: z.object({ groupId: z.string().min(1) }) };

// ─── Validate WhatsApp Numbers (before /:contactId to avoid collision) ────────
contactRouter.get('/validate', ctrl.validateNumbers);

// ─── CSV Export ───────────────────────────────────────────────────────────────
contactRouter.get('/export', ctrl.exportContacts);

// ─── Deduplication ────────────────────────────────────────────────────────────
contactRouter.post(
  '/dedupe',
  validate({ body: z.object({ dryRun: z.boolean().optional() }).optional().default({}) }),
  ctrl.dedupeContacts,
);

// ─── Contact Labels CRUD ──────────────────────────────────────────────────────
contactRouter.get('/labels', ctrl.listLabels);

contactRouter.post(
  '/labels',
  validate({
    body: z.object({
      name: z.string().min(1).max(50),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    }),
  }),
  ctrl.createLabel,
);

contactRouter.put(
  '/labels/:labelId',
  validate({
    params: z.object({ labelId: z.string().min(1) }),
    body: z.object({
      name: z.string().min(1).max(50).optional(),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    }),
  }),
  ctrl.updateLabel,
);

contactRouter.delete(
  '/labels/:labelId',
  validate({ params: z.object({ labelId: z.string().min(1) }) }),
  ctrl.deleteLabel,
);

// ─── Contacts ─────────────────────────────────────────────────────────────────
contactRouter.get('/', ctrl.listContacts);

contactRouter.post(
  '/',
  validate({
    body: z.object({
      name: z.string().min(1).max(100),
      phone: z.string().min(7),
      variables: z.record(z.string(), z.string()).optional(),
      notes: z.string().optional(),
    }),
  }),
  ctrl.createContact,
);

contactRouter.put(
  '/:contactId',
  validate({
    ...idParam,
    body: z.object({
      name: z.string().min(1).max(100).optional(),
      variables: z.record(z.string(), z.string()).optional(),
      notes: z.string().optional(),
    }),
  }),
  ctrl.updateContact,
);

contactRouter.delete('/:contactId', validate(idParam), ctrl.deleteContact);

// Label assignment on a contact
contactRouter.post(
  '/:contactId/labels',
  validate({
    ...idParam,
    body: z.object({ labelIds: z.array(z.string().min(1)).min(1) }),
  }),
  ctrl.assignLabels,
);

contactRouter.delete(
  '/:contactId/labels/:labelId',
  validate({
    params: z.object({ contactId: z.string().min(1), labelId: z.string().min(1) }),
  }),
  ctrl.removeLabelFromContact,
);

// CSV import — requires REGULAR plan or higher
contactRouter.post(
  '/import',
  requireFeature('canCsvImport'),
  upload.single('file'),
  ctrl.importContacts,
);

// ─── Groups ───────────────────────────────────────────────────────────────────
contactRouter.get('/groups', ctrl.listGroups);

contactRouter.post(
  '/groups',
  validate({ body: z.object({ name: z.string().min(1).max(100), description: z.string().optional() }) }),
  ctrl.createGroup,
);

contactRouter.put(
  '/groups/:groupId',
  validate({
    ...groupParam,
    body: z.object({ name: z.string().optional(), description: z.string().optional() }),
  }),
  ctrl.updateGroup,
);

contactRouter.delete('/groups/:groupId', validate(groupParam), ctrl.deleteGroup);

contactRouter.get('/groups/:groupId/contacts', validate(groupParam), ctrl.getGroupContacts);

contactRouter.post(
  '/groups/:groupId/members',
  validate({
    ...groupParam,
    body: z.object({ contactIds: z.array(z.string()).min(1) }),
  }),
  ctrl.addMembers,
);

contactRouter.delete(
  '/groups/:groupId/members/:contactId',
  validate({
    params: z.object({ groupId: z.string().min(1), contactId: z.string().min(1) }),
  }),
  ctrl.removeMember,
);
