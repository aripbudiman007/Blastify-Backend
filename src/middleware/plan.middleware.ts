import { Response, NextFunction } from 'express';
import { Plan } from '@prisma/client';
import { prisma } from '../prisma/client';
import { AuthenticatedRequest } from '../types';
import { errorResponse } from '../utils/response';

// Tiering integrasi default (dipakai juga oleh seed) — LITE = tools ringan,
// REGULAR = + e-commerce & platform Indonesia, MASTER/ULTRA = semua platform
const PLATFORMS_LITE = ['googleforms', 'zoho', 'generic', 'woocommerce', 'wix', 'godaddy'];
const PLATFORMS_REGULAR = [
  ...PLATFORMS_LITE,
  'shopify', 'magento2', 'bigcommerce', 'bitrix24',
  'jotform', 'typeform', 'formstack', 'webflow',
  'sejoli', 'berdu', 'cepatlakoo', 'wpaff', 'lsdplugins',
  'slims', 'opensid', 'jibas', 'mixradius',
];

// Hard-coded defaults so app works before DB seed
const PLAN_DEFAULTS: Record<Plan, {
  maxDevices: number;
  monthlyMessages: number;
  maxContacts: number;
  maxBroadcasts: number;
  canAutoReply: boolean;
  canDeviceRotation: boolean;
  canWebhook: boolean;
  canCsvImport: boolean;
  canAiReply: boolean;
  aiMonthlyReplies: number;
  hasWatermark: boolean;
  allowedMessageTypes: string[]; // kosong = semua tipe
  allowedPlatforms: string[];    // kosong = semua platform (bila canWebhook true)
}> = {
  FREE:    { maxDevices: 1,  monthlyMessages: 1_000,  maxContacts: 500,    maxBroadcasts: 3,   canAutoReply: false, canDeviceRotation: false, canWebhook: false, canCsvImport: false, canAiReply: false, aiMonthlyReplies: 0,      hasWatermark: true,  allowedMessageTypes: ['TEXT'], allowedPlatforms: [] },
  LITE:    { maxDevices: 1,  monthlyMessages: 1_000,  maxContacts: 1_000,  maxBroadcasts: 5,   canAutoReply: false, canDeviceRotation: false, canWebhook: true,  canCsvImport: false, canAiReply: false, aiMonthlyReplies: 0,      hasWatermark: false, allowedMessageTypes: ['TEXT', 'IMAGE', 'DOCUMENT'], allowedPlatforms: PLATFORMS_LITE },
  REGULAR: { maxDevices: 3,  monthlyMessages: 10_000, maxContacts: 5_000,  maxBroadcasts: 20,  canAutoReply: true,  canDeviceRotation: false, canWebhook: true,  canCsvImport: true,  canAiReply: false, aiMonthlyReplies: 0,      hasWatermark: false, allowedMessageTypes: [], allowedPlatforms: PLATFORMS_REGULAR },
  MASTER:  { maxDevices: 10, monthlyMessages: -1,     maxContacts: -1,     maxBroadcasts: -1,  canAutoReply: true,  canDeviceRotation: true,  canWebhook: true,  canCsvImport: true,  canAiReply: true,  aiMonthlyReplies: 2_000,  hasWatermark: false, allowedMessageTypes: [], allowedPlatforms: [] },
  ULTRA:   { maxDevices: -1, monthlyMessages: -1,     maxContacts: -1,     maxBroadcasts: -1,  canAutoReply: true,  canDeviceRotation: true,  canWebhook: true,  canCsvImport: true,  canAiReply: true,  aiMonthlyReplies: 10_000, hasWatermark: false, allowedMessageTypes: [], allowedPlatforms: [] },
};

/**
 * Cek apakah plan boleh membuat integrasi untuk platform tertentu.
 * allowedPlatforms kosong = semua platform diizinkan (asalkan canWebhook true).
 * Throw 403 PLATFORM_NOT_ALLOWED bila tidak diizinkan.
 */
export async function checkPlatformAllowed(plan: Plan, platformKey: string): Promise<void> {
  const limits = await getPlanLimits(plan);
  if (!limits.canWebhook) {
    const err = new Error(`Plan ${plan} belum bisa membuat integrasi. Upgrade untuk mengaktifkan fitur ini.`) as any;
    err.status = 403; err.code = 'FEATURE_NOT_AVAILABLE'; err.details = { requiredFeature: 'canWebhook' };
    throw err;
  }

  const allowed: string[] = (limits as any).allowedPlatforms ?? [];
  if (allowed.length === 0) return; // semua platform diizinkan

  const key = platformKey.toLowerCase();
  if (allowed.includes(key)) return;

  const err = new Error(
    `Platform "${platformKey}" belum tersedia di plan ${plan}. Upgrade untuk mengaktifkan integrasi ini.`,
  ) as any;
  err.status = 403;
  err.code = 'PLATFORM_NOT_ALLOWED';
  err.details = { plan, platform: key, allowedPlatforms: allowed };
  throw err;
}

/**
 * Cek apakah plan boleh mengirim tipe pesan tertentu.
 * allowedMessageTypes kosong = semua tipe diizinkan.
 * Throw 403 MESSAGE_TYPE_NOT_ALLOWED bila tidak diizinkan.
 */
export async function checkMessageTypeAllowed(plan: Plan, type: string): Promise<void> {
  const limits = await getPlanLimits(plan);
  const allowed: string[] = (limits as any).allowedMessageTypes ?? [];
  if (allowed.length === 0) return;
  if (allowed.includes(type.toUpperCase())) return;

  const err = new Error(
    `Plan ${plan} hanya bisa mengirim tipe: ${allowed.join(', ')}. Upgrade untuk mengirim ${type.toUpperCase()}.`,
  ) as any;
  err.status = 403;
  err.code = 'MESSAGE_TYPE_NOT_ALLOWED';
  err.details = { plan, type: type.toUpperCase(), allowedTypes: allowed };
  throw err;
}

// Harga bulanan default (IDR sen) — fallback bila kolom price di DB belum terisi
export const PLAN_PRICE_DEFAULTS: Record<Plan, number> = {
  FREE: 0,
  LITE: 25_000_00,
  REGULAR: 66_000_00,
  MASTER: 175_000_00,
  ULTRA: 355_000_00,
};

export async function getPlanLimits(plan: Plan) {
  // Try DB override first; fall back to hard-coded defaults if table doesn't exist yet
  try {
    const dbLimit = await (prisma as any).planLimit?.findUnique({ where: { plan } });
    if (dbLimit) return dbLimit;
  } catch {
    // table not migrated yet — use defaults
  }
  return { ...PLAN_DEFAULTS[plan], price: PLAN_PRICE_DEFAULTS[plan] };
}

/** Harga bulanan plan (IDR sen) — dari DB, fallback ke default */
export async function getPlanPrice(plan: Plan): Promise<number> {
  const limits = await getPlanLimits(plan);
  const price = (limits as any).price;
  return typeof price === 'number' && price > 0 ? price : PLAN_PRICE_DEFAULTS[plan];
}

// ── Check monthly message quota ────────────────────────────────────────────────
/**
 * Cek kuota pesan bulanan sesuai plan. Throw 429 QUOTA_EXCEEDED bila sudah
 * mencapai limit — dipakai baik oleh quotaMiddleware (native /messages/send)
 * maupun dipanggil langsung dari compat.route.ts (/blastify/*), karena route
 * compat tidak lewat middleware chain yang sama.
 */
export async function checkMessageQuota(
  userId: string,
  plan: Plan,
  email: string,
  name: string,
): Promise<void> {
  const limits = await getPlanLimits(plan);
  if (limits.monthlyMessages === -1) return; // unlimited

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const count = await prisma.message.count({
    where: { userId, createdAt: { gte: startOfMonth } },
  });

  if (count >= limits.monthlyMessages) {
    const err = new Error(
      `Monthly message quota reached (${limits.monthlyMessages.toLocaleString()} messages). Upgrade your plan.`,
    ) as any;
    err.status = 429;
    err.code = 'QUOTA_EXCEEDED';
    err.details = { used: count, limit: limits.monthlyMessages, plan };
    throw err;
  }

  // Quota warning email at 80% — sent at most once per user per month
  if (count + 1 >= Math.ceil(limits.monthlyMessages * 0.8)) {
    void notifyQuotaWarning(userId, email, name, plan, count, limits.monthlyMessages);
  }
}

export function quotaMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  // Run async check without blocking the type system
  (async () => {
    try {
      const user = req.user!;
      await checkMessageQuota(user.id, user.plan, user.email, user.name);
      next();
    } catch (err: any) {
      if (err.code === 'QUOTA_EXCEEDED') {
        errorResponse(res, err.status, err.code, err.message, err.details);
        return;
      }
      next(err);
    }
  })();
}

async function notifyQuotaWarning(
  userId: string,
  email: string,
  name: string,
  plan: Plan,
  used: number,
  limit: number,
): Promise<void> {
  try {
    const { getRedisClient } = await import('../redis/client');
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM
    const key = `quota-warn:${userId}:${month}`;
    // NX — only the first request that crosses 80% sends the email
    const set = await getRedisClient().set(key, '1', 'EX', 35 * 24 * 60 * 60, 'NX');
    if (set !== 'OK') return;

    const { sendQuotaWarningEmail } = await import('../services/email.service');
    await sendQuotaWarningEmail(email, name, used, limit, plan, userId);
  } catch {
    // non-critical — never block message sending
  }
}

// ── Feature gate factory ───────────────────────────────────────────────────────
type FeatureFlag = 'canAutoReply' | 'canDeviceRotation' | 'canWebhook' | 'canCsvImport' | 'canAiReply';

export function requireFeature(flag: FeatureFlag) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    (async () => {
      try {
        const limits = await getPlanLimits(req.user!.plan);
        if (!limits[flag]) {
          errorResponse(
            res,
            403,
            'FEATURE_NOT_AVAILABLE',
            `This feature requires a higher plan. Current plan: ${req.user!.plan}`,
            { requiredFeature: flag },
          );
          return;
        }
        next();
      } catch (err) {
        next(err);
      }
    })();
  };
}

// ── Device count gate ──────────────────────────────────────────────────────────
export async function checkDeviceLimit(userId: string, plan: Plan): Promise<void> {
  const limits = await getPlanLimits(plan);
  if (limits.maxDevices === -1) return;

  const count = await prisma.device.count({ where: { userId } });
  if (count >= limits.maxDevices) {
    const err = new Error(
      `Device limit reached (${limits.maxDevices} devices on ${plan} plan). Upgrade to add more.`,
    ) as any;
    err.status = 403;
    err.code = 'DEVICE_LIMIT_REACHED';
    throw err;
  }
}

// ── Contact count gate ─────────────────────────────────────────────────────────
export async function checkContactLimit(userId: string, plan: Plan): Promise<void> {
  const limits = await getPlanLimits(plan);
  if (limits.maxContacts === -1) return;

  const count = await prisma.contact.count({ where: { userId } });
  if (count >= limits.maxContacts) {
    const err = new Error(
      `Contact limit reached (${limits.maxContacts.toLocaleString()} contacts on ${plan} plan). Upgrade to add more.`,
    ) as any;
    err.status = 403;
    err.code = 'CONTACT_LIMIT_REACHED';
    throw err;
  }
}

// ── Broadcast count gate ───────────────────────────────────────────────────────
export async function checkBroadcastLimit(userId: string, plan: Plan): Promise<void> {
  const limits = await getPlanLimits(plan);
  if (limits.maxBroadcasts === -1) return;

  const count = await prisma.broadcast.count({ where: { userId } });
  if (count >= limits.maxBroadcasts) {
    const err = new Error(
      `Broadcast limit reached (${limits.maxBroadcasts.toLocaleString()} broadcasts on ${plan} plan). Upgrade to add more.`,
    ) as any;
    err.status = 403;
    err.code = 'BROADCAST_LIMIT_REACHED';
    throw err;
  }
}
