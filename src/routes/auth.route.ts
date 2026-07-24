import { Router } from 'express';
import { z } from 'zod';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { register, login, refresh, logout, forgot, reset, verify, resendVerify } from '../controllers/auth.controller';
import { validate } from '../middleware/validate.middleware';
import { redisRateLimitStore } from '../config/rateLimit';

export const authRouter = Router();

// Brute-force protection: strict limits on credential endpoints (keyed by IP)
const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisRateLimitStore('login'),
  keyGenerator: (req) => `login:${ipKeyGenerator(req.ip ?? '')}`,
  message: {
    success: false,
    error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many login attempts. Try again in 15 minutes.' },
  },
});

const registerRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisRateLimitStore('register'),
  keyGenerator: (req) => `register:${ipKeyGenerator(req.ip ?? '')}`,
  message: {
    success: false,
    error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many accounts created from this IP. Try again later.' },
  },
});

const emailFlowRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisRateLimitStore('emailflow'),
  keyGenerator: (req) => `emailflow:${ipKeyGenerator(req.ip ?? '')}`,
  message: {
    success: false,
    error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests. Try again later.' },
  },
});

authRouter.post(
  '/register',
  registerRateLimit,
  validate({
    body: z.object({
      name: z.string().min(2).max(100),
      email: z.string().email(),
      password: z.string().min(8).max(100),
    }),
  }),
  register,
);

authRouter.post(
  '/login',
  loginRateLimit,
  validate({
    body: z.object({
      email: z.string().email(),
      password: z.string().min(1),
      otp: z.string().length(6).optional(),
    }),
  }),
  login,
);

authRouter.get(
  '/verify-email',
  validate({ query: z.object({ token: z.string().min(1) }) }),
  verify,
);

authRouter.post(
  '/resend-verification',
  emailFlowRateLimit,
  validate({ body: z.object({ email: z.string().email() }) }),
  resendVerify,
);

authRouter.post(
  '/refresh',
  validate({
    body: z.object({ refreshToken: z.string().min(1) }),
  }),
  refresh,
);

authRouter.post(
  '/logout',
  validate({ body: z.object({ refreshToken: z.string().min(1) }) }),
  logout,
);

authRouter.post(
  '/forgot-password',
  emailFlowRateLimit,
  validate({ body: z.object({ email: z.string().email() }) }),
  forgot,
);

authRouter.post(
  '/reset-password',
  validate({
    body: z.object({
      token: z.string().min(1),
      password: z.string().min(8).max(100),
    }),
  }),
  reset,
);
