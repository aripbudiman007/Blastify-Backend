import { Router } from 'express';
import { z } from 'zod';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { adminAuthMiddleware, requireRole } from '../../middleware/admin.middleware';
import { validate } from '../../middleware/validate.middleware';
import { redisRateLimitStore } from '../../config/rateLimit';

// Controllers
import { login, me } from '../../controllers/admin/admin-auth.controller';
import { stats } from '../../controllers/admin/admin-dashboard.controller';
import {
  listUsers, getUserDetail, updateUserPlan, updateUserStatus, deleteUser,
} from '../../controllers/admin/admin-user.controller';
import {
  listInvoices, getInvoice, confirmInvoice, cancelInvoice,
} from '../../controllers/admin/admin-invoice.controller';
import {
  listDevices, forceDisconnectDevice, deleteDevice,
} from '../../controllers/admin/admin-device.controller';
import { listBroadcasts, stopBroadcast } from '../../controllers/admin/admin-broadcast.controller';
import {
  listAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement,
} from '../../controllers/admin/admin-announcement.controller';
import {
  listAuditLogs, listAdmins, createAdmin, updateAdminStatus,
} from '../../controllers/admin/admin-manage.controller';
import { revenueReport } from '../../controllers/admin/admin-report.controller';
import { listPlanLimits, updatePlanLimit } from '../../controllers/admin/admin-plan.controller';
import {
  listGlobalTemplates, createGlobalTemplate, updateGlobalTemplate, deleteGlobalTemplate,
} from '../../controllers/admin/admin-email-template.controller';

export const adminRouter = Router();

// ─── Auth (public within /admin) ─────────────────────────────────────────────
// Brute-force protection: admin accounts have elevated privileges, so this is
// stricter than the regular user login limiter (10/15min in auth.route.ts).
const adminLoginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisRateLimitStore('admin-login'),
  keyGenerator: (req) => `admin-login:${ipKeyGenerator(req.ip ?? '')}`,
  message: {
    success: false,
    error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many admin login attempts. Try again in 15 minutes.' },
  },
});

adminRouter.post('/auth/login', adminLoginRateLimit, validate({
  body: z.object({ email: z.string().email(), password: z.string().min(1) }),
}), login);

// All routes below require admin token
adminRouter.use(adminAuthMiddleware);
adminRouter.get('/auth/me', me);

// ─── Dashboard ───────────────────────────────────────────────────────────────
adminRouter.get('/dashboard/stats', stats);

// ─── Reports ─────────────────────────────────────────────────────────────────
adminRouter.get('/reports/revenue', revenueReport);

// ─── Plan Limits & Pricing ───────────────────────────────────────────────────
adminRouter.get('/plans', listPlanLimits);
adminRouter.put('/plans/:plan', requireRole('SUPER_ADMIN', 'ADMIN'), validate({
  params: z.object({ plan: z.enum(['FREE', 'LITE', 'REGULAR', 'MASTER', 'ULTRA']) }),
  body: z.object({
    price: z.number().int().min(0).optional(),               // IDR sen
    maxDevices: z.number().int().min(-1).optional(),
    monthlyMessages: z.number().int().min(-1).optional(),
    maxContacts: z.number().int().min(-1).optional(),
    maxBroadcasts: z.number().int().min(-1).optional(),
    messageRetentionDays: z.number().int().min(-1).optional(),
    maxTemplates: z.number().int().min(-1).optional(),
    aiMonthlyReplies: z.number().int().min(-1).optional(),
    canAutoReply: z.boolean().optional(),
    canDeviceRotation: z.boolean().optional(),
    canSchedule: z.boolean().optional(),
    canWebhook: z.boolean().optional(),
    canCsvImport: z.boolean().optional(),
    canIpWhitelist: z.boolean().optional(),
    canAiReply: z.boolean().optional(),
    hasWatermark: z.boolean().optional(),
    allowedMessageTypes: z.array(
      z.enum(['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT', 'AUDIO', 'LOCATION', 'CONTACT', 'TEMPLATE', 'LIST', 'BUTTON']),
    ).optional(), // array kosong = semua tipe diizinkan
    allowedPlatforms: z.array(z.string().min(1).max(50)).optional(), // key dari GET /integrations/platforms; array kosong = semua platform
  }).refine((d) => Object.keys(d).length > 0, { message: 'At least one field required' }),
}), updatePlanLimit);

// ─── Users ───────────────────────────────────────────────────────────────────
adminRouter.get('/users', listUsers);
adminRouter.get('/users/:id', getUserDetail);
adminRouter.put('/users/:id/plan', validate({
  body: z.object({
    plan: z.enum(['FREE', 'LITE', 'REGULAR', 'MASTER', 'ULTRA']),
    expiresAt: z.string().datetime().optional(),
  }),
}), updateUserPlan);
adminRouter.put('/users/:id/status', validate({
  body: z.object({ isActive: z.boolean() }),
}), updateUserStatus);
adminRouter.delete('/users/:id', requireRole('SUPER_ADMIN', 'ADMIN'), deleteUser);

// ─── Invoices ────────────────────────────────────────────────────────────────
adminRouter.get('/invoices', listInvoices);
adminRouter.get('/invoices/:id', getInvoice);
adminRouter.put('/invoices/:id/confirm', requireRole('SUPER_ADMIN', 'ADMIN'), confirmInvoice);
adminRouter.put('/invoices/:id/cancel', requireRole('SUPER_ADMIN', 'ADMIN'), cancelInvoice);

// ─── Devices ─────────────────────────────────────────────────────────────────
adminRouter.get('/devices', listDevices);
adminRouter.put('/devices/:id/disconnect', requireRole('SUPER_ADMIN', 'ADMIN'), forceDisconnectDevice);
adminRouter.delete('/devices/:id', requireRole('SUPER_ADMIN', 'ADMIN'), deleteDevice);

// ─── Broadcasts ──────────────────────────────────────────────────────────────
adminRouter.get('/broadcasts', listBroadcasts);
adminRouter.put('/broadcasts/:id/stop', requireRole('SUPER_ADMIN', 'ADMIN'), stopBroadcast);

// ─── Announcements ───────────────────────────────────────────────────────────
adminRouter.get('/announcements', listAnnouncements);
adminRouter.post('/announcements', requireRole('SUPER_ADMIN', 'ADMIN'), validate({
  body: z.object({
    title: z.string().min(1).max(200),
    content: z.string().min(1),
    type: z.enum(['INFO', 'WARNING', 'DANGER', 'SUCCESS', 'MAINTENANCE']).optional(),
    isActive: z.boolean().optional(),
    startsAt: z.string().datetime().nullable().optional(),
    endsAt: z.string().datetime().nullable().optional(),
    targetPlan: z.array(z.enum(['FREE', 'LITE', 'REGULAR', 'MASTER', 'ULTRA'])).optional(),
  }),
}), createAnnouncement);
adminRouter.put('/announcements/:id', requireRole('SUPER_ADMIN', 'ADMIN'), updateAnnouncement);
adminRouter.delete('/announcements/:id', requireRole('SUPER_ADMIN', 'ADMIN'), deleteAnnouncement);

// ─── Email Templates (system-wide defaults) ─────────────────────────────────
adminRouter.get('/email-templates', listGlobalTemplates);
adminRouter.post('/email-templates', requireRole('SUPER_ADMIN', 'ADMIN'), validate({
  body: z.object({
    name: z.string().min(1).max(255),
    slug: z.string().min(1).max(255).regex(/^[a-z0-9-]+$/),
    category: z.enum(['registration', 'account', 'payment', 'notification']).optional(),
    subject: z.string().min(1).max(255),
    htmlContent: z.string().min(1),
    plainTextContent: z.string().optional(),
  }),
}), createGlobalTemplate);
adminRouter.put('/email-templates/:id', requireRole('SUPER_ADMIN', 'ADMIN'), validate({
  body: z.object({
    name: z.string().min(1).max(255).optional(),
    category: z.enum(['registration', 'account', 'payment', 'notification']).optional(),
    subject: z.string().min(1).max(255).optional(),
    htmlContent: z.string().min(1).optional(),
    plainTextContent: z.string().nullable().optional(),
    isActive: z.boolean().optional(),
  }),
}), updateGlobalTemplate);
adminRouter.delete('/email-templates/:id', requireRole('SUPER_ADMIN', 'ADMIN'), deleteGlobalTemplate);

// ─── Audit Logs ──────────────────────────────────────────────────────────────
adminRouter.get('/audit-logs', listAuditLogs);

// ─── Admin Management (SUPER_ADMIN only) ─────────────────────────────────────
adminRouter.get('/admins', requireRole('SUPER_ADMIN'), listAdmins);
adminRouter.post('/admins', requireRole('SUPER_ADMIN'), validate({
  body: z.object({
    email: z.string().email(),
    name: z.string().min(1),
    password: z.string().min(8),
    role: z.enum(['SUPER_ADMIN', 'ADMIN', 'STAFF']).optional(),
  }),
}), createAdmin);
adminRouter.put('/admins/:id/status', requireRole('SUPER_ADMIN'), validate({
  body: z.object({ isActive: z.boolean() }),
}), updateAdminStatus);
