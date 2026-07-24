import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3000').transform(Number),
  APP_URL: z.string().url().default('http://localhost:3000'),
  // URL publik frontend (SPA) — dipakai untuk redirect balik dari payment gateway
  // (returnUrl/cancelUrl), BEDA dari APP_URL yang menunjuk ke backend API ini sendiri
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  ADMIN_JWT_SECRET: z.string().min(32, 'ADMIN_JWT_SECRET must be at least 32 chars and cannot have a default'),
  ADMIN_JWT_EXPIRES_IN: z.string().default('8h'),

  SESSION_SECRET_KEY: z.string().length(32, 'SESSION_SECRET_KEY must be exactly 32 chars'),

  WEBHOOK_TIMEOUT_MS: z.string().default('10000').transform(Number),
  WEBHOOK_MAX_RETRIES: z.string().default('3').transform(Number),

  RATE_LIMIT_WINDOW_MS: z.string().default('60000').transform(Number),
  RATE_LIMIT_MAX_REQUESTS: z.string().default('60').transform(Number),

  MESSAGE_DELAY_MIN_MS: z.string().default('1000').transform(Number),
  MESSAGE_DELAY_MAX_MS: z.string().default('3000').transform(Number),
  MESSAGE_MAX_RETRIES: z.string().default('3').transform(Number),

  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_FILE_SIZE_MB: z.string().default('16').transform(Number),

  ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),

  // Payment gateway — optional; upgradePlan falls back to manual flow if unset
  PAYMENT_PROVIDER: z.enum(['ipaymu', 'midtrans']).default('ipaymu'),

  // iPaymu (https://ipaymu.com — VA & API key dari dashboard)
  IPAYMU_VA: z.string().optional(),
  IPAYMU_API_KEY: z.string().optional(),
  IPAYMU_IS_PRODUCTION: z.string().default('false').transform((v) => v === 'true'),

  // Midtrans (alternatif)
  MIDTRANS_SERVER_KEY: z.string().optional(),
  MIDTRANS_CLIENT_KEY: z.string().optional(),
  MIDTRANS_IS_PRODUCTION: z.string().default('false').transform((v) => v === 'true'),

  // SMTP email — optional; emails are skipped (logged) if unset
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().default('587').transform(Number),
  SMTP_SECURE: z.string().default('false').transform((v) => v === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().default('Blastify <no-reply@localhost>'),
  EMAIL_VERIFICATION_REQUIRED: z.string().default('false').transform((v) => v === 'true'),

  // Cloudinary media upload — optional; /media/upload returns 503 if unset
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  // AI auto-reply — optional; AI rules are skipped if provider key unset
  AI_PROVIDER: z.enum(['gemini', 'openai']).default('gemini'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-5-mini'),
  AI_MAX_OUTPUT_TOKENS: z.string().default('300').transform(Number),
  AI_CONTEXT_MESSAGES: z.string().default('6').transform(Number),

  // Sentry error tracking — optional; disabled entirely if unset
  SENTRY_DSN: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.string().default('0').transform(Number),
});

const _parsed = envSchema.safeParse(process.env);

if (!_parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(_parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = _parsed.data;
