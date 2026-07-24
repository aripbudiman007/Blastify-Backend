import { Router } from 'express';
import { z } from 'zod';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { authMiddleware } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { quotaMiddleware } from '../middleware/plan.middleware';
import { send, sendBulk, list, detail, scheduled, cancel, revoke } from '../controllers/message.controller';
import { config } from '../config';
import { redisRateLimitStore } from '../config/rateLimit';

export const messageRouter = Router();

messageRouter.use(authMiddleware);

const sendRateLimit = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: 20,
  store: redisRateLimitStore('send'),
  keyGenerator: (req) => {
    const key = req.headers['x-api-key'] as string;
    const body = req.body?.deviceId ?? '';
    return `${key || ipKeyGenerator(req.ip ?? '')}:${body}`;
  },
  message: {
    success: false,
    error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Send rate limit exceeded for this device' },
  },
});

const bulkRateLimit = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: 5,
  store: redisRateLimitStore('bulk'),
  keyGenerator: (req) => {
    const key = req.headers['x-api-key'] as string;
    const body = req.body?.deviceId ?? '';
    return `bulk:${key || ipKeyGenerator(req.ip ?? '')}:${body}`;
  },
  message: {
    success: false,
    error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Bulk send rate limit exceeded' },
  },
});

const messageTypes = ['text', 'image', 'video', 'document', 'audio', 'location', 'contact', 'template', 'list', 'button'] as const;

// Accept any case — normalize to lowercase before enum check
const messageTypeField = z
  .string()
  .transform((v) => v.toLowerCase())
  .pipe(z.enum(messageTypes))
  .default('text');

const sendSchema = z
  .object({
    deviceId: z.string().min(1),
    to: z.string().min(7),
    type: messageTypeField,
    message: z.string().min(1).optional(),
    url: z.string().url().optional(),
    caption: z.string().optional(),
    scheduledAt: z.string().datetime().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    linkPreview: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    const textTypes = ['text', 'template', 'contact'];
    const mediaTypes = ['image', 'video', 'document', 'audio'];

    if (textTypes.includes(data.type) && !data.message) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['message'],
        message: `Field "message" is required for type "${data.type}"`,
      });
    }
    if (mediaTypes.includes(data.type) && !data.url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['url'],
        message: `Field "url" is required for type "${data.type}"`,
      });
    }
    if (data.type === 'location' && (data.latitude == null || data.longitude == null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['latitude'],
        message: 'Fields "latitude" and "longitude" are required for type "location"',
      });
    }
    // list and button require JSON in message field
    if (['list', 'button'].includes(data.type) && !data.message) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['message'],
        message: `Field "message" (JSON string) is required for type "${data.type}"`,
      });
    }
  });

const bulkSchema = z
  .object({
    deviceId: z.string().min(1),
    recipients: z.array(z.string().min(7)).min(1).max(50),
    type: messageTypeField,
    message: z.string().min(1).optional(),
    url: z.string().url().optional(),
    caption: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const textTypes = ['text', 'template', 'contact'];
    const mediaTypes = ['image', 'video', 'document', 'audio'];

    if (textTypes.includes(data.type) && !data.message) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['message'],
        message: `Field "message" is required for type "${data.type}"`,
      });
    }
    if (mediaTypes.includes(data.type) && !data.url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['url'],
        message: `Field "url" is required for type "${data.type}"`,
      });
    }
  });

messageRouter.post('/send', sendRateLimit, quotaMiddleware, validate({ body: sendSchema }), send);
messageRouter.post('/send-bulk', bulkRateLimit, quotaMiddleware, validate({ body: bulkSchema }), sendBulk);
messageRouter.get('/', list);
messageRouter.get('/scheduled', scheduled);
messageRouter.get(
  '/:messageId',
  validate({ params: z.object({ messageId: z.string().min(1) }) }),
  detail,
);
messageRouter.delete(
  '/:messageId',
  validate({ params: z.object({ messageId: z.string().min(1) }) }),
  cancel,
);

// Tarik pesan terkirim (delete for everyone)
messageRouter.post(
  '/:messageId/revoke',
  validate({ params: z.object({ messageId: z.string().min(1) }) }),
  revoke,
);
