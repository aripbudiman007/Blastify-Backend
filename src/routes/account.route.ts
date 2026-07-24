import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { authMiddleware } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { redisRateLimitStore } from '../config/rateLimit';
import { AuthenticatedRequest } from '../types';
import {
  getMe, updateMe, getApiKey, regenerateApiKey, getStats,
  getInvoices, upgradePlan, getAiUsage,
  setup2fa, enable2fa, disable2fa,
} from '../controllers/account.controller';

export const accountRouter = Router();
accountRouter.use(authMiddleware);

// Payment brute-force / invoice-spam protection — keyed by authenticated user.
const upgradeRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisRateLimitStore('upgrade'),
  keyGenerator: (req) => `upgrade:${(req as AuthenticatedRequest).user!.id}`,
  message: {
    success: false,
    error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many upgrade attempts. Try again in 1 hour.' },
  },
});

// 2FA brute-force protection — prevents guessing the 6-digit OTP or the account password.
const twoFaRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisRateLimitStore('2fa'),
  keyGenerator: (req) => `2fa:${(req as AuthenticatedRequest).user!.id}`,
  message: {
    success: false,
    error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many attempts. Try again in 15 minutes.' },
  },
});

accountRouter.get('/me', getMe);
accountRouter.put(
  '/me',
  validate({
    body: z.object({
      name: z.string().min(2).max(100).optional(),
      password: z.string().min(8).max(100).optional(),
    }).refine((d) => d.name || d.password, { message: 'At least one field required' }),
  }),
  updateMe,
);

accountRouter.get('/stats', getStats);
accountRouter.get('/api-key', getApiKey);
accountRouter.post('/api-key/regenerate', regenerateApiKey);

accountRouter.get('/invoices', getInvoices);
accountRouter.get('/ai-usage', getAiUsage);

// 2FA (TOTP)
accountRouter.post('/2fa/setup', setup2fa);
accountRouter.post(
  '/2fa/enable',
  twoFaRateLimit,
  validate({ body: z.object({ otp: z.string().length(6) }) }),
  enable2fa,
);
accountRouter.post(
  '/2fa/disable',
  twoFaRateLimit,
  validate({ body: z.object({ password: z.string().min(1) }) }),
  disable2fa,
);
accountRouter.post(
  '/upgrade',
  upgradeRateLimit,
  validate({ body: z.object({ plan: z.string().min(1) }) }),
  upgradePlan,
);
