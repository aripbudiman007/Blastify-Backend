import { Router, Request, Response, NextFunction } from 'express';
import { Plan } from '@prisma/client';
import { getPlanLimits, PLAN_PRICE_DEFAULTS } from '../middleware/plan.middleware';
import { listPlatforms } from '../integrations/platforms';

export const planRouter = Router();

const PLAN_ORDER: Plan[] = ['FREE', 'LITE', 'REGULAR', 'MASTER', 'ULTRA'];

/**
 * GET /plans — publik, untuk halaman pricing frontend.
 * Mengembalikan limit + harga setiap plan (harga dalam IDR sen).
 */
planRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const plans = await Promise.all(
      PLAN_ORDER.map(async (plan) => {
        const limits = await getPlanLimits(plan);
        const price =
          typeof (limits as any).price === 'number' && (limits as any).price > 0
            ? (limits as any).price
            : PLAN_PRICE_DEFAULTS[plan];
        const allowedTypes: string[] = (limits as any).allowedMessageTypes ?? [];
        const hasWatermark = Boolean((limits as any).hasWatermark);
        const allowedPlatforms: string[] = (limits as any).allowedPlatforms ?? [];
        const allPlatformKeys = listPlatforms().map((p) => p.key);
        const integrationPlatforms = !limits.canWebhook
          ? []
          : allowedPlatforms.length === 0
            ? 'all'
            : allowedPlatforms;
        return {
          plan,
          price,
          priceLabel: price === 0 ? 'Gratis' : `Rp ${(price / 100).toLocaleString('id-ID')}/bulan`,
          watermark: hasWatermark,
          watermarkNote: hasWatermark
            ? 'Setiap pesan keluar diberi watermark Blastify. Upgrade ke plan berbayar untuk menghapusnya.'
            : null,
          allowedMessageTypes: allowedTypes.length === 0 ? 'all' : allowedTypes,
          messageTypeNote: allowedTypes.length === 0
            ? 'Semua tipe pesan: teks, gambar, video, dokumen, audio, lokasi, list, button'
            : `Hanya tipe: ${allowedTypes.join(', ')}`,
          limits: {
            maxDevices: limits.maxDevices,
            monthlyMessages: limits.monthlyMessages,
            maxContacts: limits.maxContacts,
            maxBroadcasts: limits.maxBroadcasts,
            messageRetentionDays: (limits as any).messageRetentionDays ?? null,
            maxTemplates: (limits as any).maxTemplates ?? null,
            aiMonthlyReplies: (limits as any).aiMonthlyReplies ?? 0,
          },
          features: {
            autoReply: limits.canAutoReply,
            aiReply: (limits as any).canAiReply ?? false,
            deviceRotation: limits.canDeviceRotation,
            webhook: limits.canWebhook,
            csvImport: limits.canCsvImport,
            ipWhitelist: (limits as any).canIpWhitelist ?? false,
          },
          integrations: {
            enabled: limits.canWebhook,
            allowedPlatforms: integrationPlatforms, // "all" | [] (tidak ada) | array key
            totalPlatformsAvailable: allPlatformKeys.length,
          },
        };
      }),
    );
    res.json({ success: true, data: { plans } });
  } catch (err) {
    next(err);
  }
});
