/**
 * Blastify API Layer
 * ─────────────────────────────────────────────────────────────────────────────
 * Exposes endpoints compatible with Wablas/Fonnte API format so existing
 * n8n workflows and third-party integrations can be redirected to Blastify
 * with minimal changes.
 *
 * Auth: Authorization: <apiKey>
 *   OR: Bearer <JWT>             (native auth)
 *
 * Base: /blastify
 *
 * Endpoints:
 *   POST /blastify/send-message       → send text
 *   POST /blastify/send-image         → send image
 *   POST /blastify/send-video         → send video
 *   POST /blastify/send-document      → send document
 *   POST /blastify/send-audio         → send audio
 *   POST /blastify/send-location      → send location
 *   POST /blastify/send-list-message  → send interactive list
 *   POST /blastify/send-button-message→ send button
 *   GET  /blastify/check-number       → validate WA number
 *   GET  /blastify/device             → get device info
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma/client';
import { sendMessage } from '../services/message.service';
import { getSession } from '../baileys/session';
import { checkMessageQuota } from '../middleware/plan.middleware';
import { MessageType } from '@prisma/client';

export const compatRouter = Router();

// ─── Auth middleware (API Key via Authorization header, no Bearer prefix) ──────
async function compatAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'] ?? req.headers['token'] as string;
  if (!authHeader) {
    res.status(401).json({ status: false, message: 'Authorization token is required' });
    return;
  }

  // Strip "Bearer " prefix if present (support both formats)
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

  const user = await prisma.user.findUnique({ where: { apiKey: token } });
  if (!user || !user.isActive) {
    res.status(401).json({ status: false, message: 'Invalid or inactive API token' });
    return;
  }

  (req as any).compatUser = user;
  next();
}

compatRouter.use(compatAuth);

/** Blastify success response */
function ok(res: Response, data: object) {
  res.json({ status: true, ...data });
}

/** Blastify error response */
function fail(res: Response, status: number, message: string) {
  res.status(status).json({ status: false, message });
}

/**
 * Cek kuota pesan bulanan sebelum kirim — route compat ini tidak lewat
 * quotaMiddleware (yang cuma dipasang di message.route.ts), jadi kuota harus
 * dicek manual di sini supaya plan FREE/LITE/dst tetap dibatasi walau
 * dikirim lewat integrasi Wablas-compatible ini, bukan cuma lewat API native.
 */
async function enforceQuota(res: Response, user: { id: string; plan: any; email: string; name: string }): Promise<boolean> {
  try {
    await checkMessageQuota(user.id, user.plan, user.email, user.name);
    return true;
  } catch (err: any) {
    fail(res, err.status ?? 429, err.message ?? 'Monthly message quota reached');
    return false;
  }
}

/** Get first connected device for this user, or use provided phone/device */
async function resolveDevice(userId: string, phone?: string): Promise<string | null> {
  if (phone) {
    // Look up by device phone number
    const d = await prisma.device.findFirst({
      where: { userId, phone, status: 'CONNECTED' },
    });
    if (d) return d.id;
  }
  // Default: first connected device
  const d = await prisma.device.findFirst({
    where: { userId, status: 'CONNECTED' },
    orderBy: { createdAt: 'asc' },
  });
  return d?.id ?? null;
}

// ─── POST /blastify/send-message ────────────────────────────────────────────────
compatRouter.post('/send-message', async (req: Request, res: Response) => {
  try {
    const user = (req as any).compatUser;
    const { phone, message, secret_device: devicePhone } = req.body;

    if (!phone || !message) {
      fail(res, 400, 'Fields "phone" and "message" are required'); return;
    }

    const deviceId = await resolveDevice(user.id, devicePhone);
    if (!deviceId) { fail(res, 400, 'No connected device found'); return; }
    if (!(await enforceQuota(res, user))) return;

    const result = await sendMessage(user.id, {
      deviceId, to: String(phone), type: MessageType.TEXT, message: String(message),
    });
    ok(res, { message: { id: result.id, to: phone, status: result.status } });
  } catch (err: any) {
    fail(res, err.status ?? 500, err.message);
  }
});

// ─── POST /blastify/send-image ──────────────────────────────────────────────────
compatRouter.post('/send-image', async (req: Request, res: Response) => {
  try {
    const user = (req as any).compatUser;
    const { phone, image, caption, secret_device: devicePhone } = req.body;
    if (!phone || !image) { fail(res, 400, 'Fields "phone" and "image" (URL) are required'); return; }

    const deviceId = await resolveDevice(user.id, devicePhone);
    if (!deviceId) { fail(res, 400, 'No connected device found'); return; }
    if (!(await enforceQuota(res, user))) return;

    const result = await sendMessage(user.id, {
      deviceId, to: String(phone), type: MessageType.IMAGE, url: String(image), caption: caption ? String(caption) : undefined,
    });
    ok(res, { message: { id: result.id, to: phone, status: result.status } });
  } catch (err: any) { fail(res, err.status ?? 500, err.message); }
});

// ─── POST /blastify/send-video ──────────────────────────────────────────────────
compatRouter.post('/send-video', async (req: Request, res: Response) => {
  try {
    const user = (req as any).compatUser;
    const { phone, video, caption, secret_device: devicePhone } = req.body;
    if (!phone || !video) { fail(res, 400, 'Fields "phone" and "video" (URL) are required'); return; }

    const deviceId = await resolveDevice(user.id, devicePhone);
    if (!deviceId) { fail(res, 400, 'No connected device found'); return; }
    if (!(await enforceQuota(res, user))) return;

    const result = await sendMessage(user.id, {
      deviceId, to: String(phone), type: MessageType.VIDEO, url: String(video), caption: caption ? String(caption) : undefined,
    });
    ok(res, { message: { id: result.id, to: phone, status: result.status } });
  } catch (err: any) { fail(res, err.status ?? 500, err.message); }
});

// ─── POST /blastify/send-document ───────────────────────────────────────────────
compatRouter.post('/send-document', async (req: Request, res: Response) => {
  try {
    const user = (req as any).compatUser;
    const { phone, document, caption, secret_device: devicePhone } = req.body;
    if (!phone || !document) { fail(res, 400, 'Fields "phone" and "document" (URL) are required'); return; }

    const deviceId = await resolveDevice(user.id, devicePhone);
    if (!deviceId) { fail(res, 400, 'No connected device found'); return; }
    if (!(await enforceQuota(res, user))) return;

    const result = await sendMessage(user.id, {
      deviceId, to: String(phone), type: MessageType.DOCUMENT, url: String(document), caption: caption ? String(caption) : undefined,
    });
    ok(res, { message: { id: result.id, to: phone, status: result.status } });
  } catch (err: any) { fail(res, err.status ?? 500, err.message); }
});

// ─── POST /blastify/send-audio ──────────────────────────────────────────────────
compatRouter.post('/send-audio', async (req: Request, res: Response) => {
  try {
    const user = (req as any).compatUser;
    const { phone, audio, secret_device: devicePhone } = req.body;
    if (!phone || !audio) { fail(res, 400, 'Fields "phone" and "audio" (URL) are required'); return; }

    const deviceId = await resolveDevice(user.id, devicePhone);
    if (!deviceId) { fail(res, 400, 'No connected device found'); return; }
    if (!(await enforceQuota(res, user))) return;

    const result = await sendMessage(user.id, {
      deviceId, to: String(phone), type: MessageType.AUDIO, url: String(audio),
    });
    ok(res, { message: { id: result.id, to: phone, status: result.status } });
  } catch (err: any) { fail(res, err.status ?? 500, err.message); }
});

// ─── POST /blastify/send-location ───────────────────────────────────────────────
compatRouter.post('/send-location', async (req: Request, res: Response) => {
  try {
    const user = (req as any).compatUser;
    const { phone, latitude, longitude, secret_device: devicePhone } = req.body;
    if (!phone || latitude == null || longitude == null) {
      fail(res, 400, 'Fields "phone", "latitude", "longitude" are required'); return;
    }

    const deviceId = await resolveDevice(user.id, devicePhone);
    if (!deviceId) { fail(res, 400, 'No connected device found'); return; }
    if (!(await enforceQuota(res, user))) return;

    const result = await sendMessage(user.id, {
      deviceId, to: String(phone), type: MessageType.LOCATION,
      latitude: Number(latitude), longitude: Number(longitude),
    });
    ok(res, { message: { id: result.id, to: phone, status: result.status } });
  } catch (err: any) { fail(res, err.status ?? 500, err.message); }
});

// ─── POST /blastify/send-list-message ───────────────────────────────────────────
compatRouter.post('/send-list-message', async (req: Request, res: Response) => {
  try {
    const user = (req as any).compatUser;
    const { phone, title, text, footer, button, sections, secret_device: devicePhone } = req.body;
    if (!phone || !text || !sections) {
      fail(res, 400, 'Fields "phone", "text", "sections" are required'); return;
    }

    const deviceId = await resolveDevice(user.id, devicePhone);
    if (!deviceId) { fail(res, 400, 'No connected device found'); return; }
    if (!(await enforceQuota(res, user))) return;

    const listJson = JSON.stringify({ title, text, footer, buttonText: button, sections });
    const result = await sendMessage(user.id, {
      deviceId, to: String(phone), type: MessageType.LIST, message: listJson,
    });
    ok(res, { message: { id: result.id, to: phone, status: result.status } });
  } catch (err: any) { fail(res, err.status ?? 500, err.message); }
});

// ─── POST /blastify/send-button-message ────────────────────────────────────────
compatRouter.post('/send-button-message', async (req: Request, res: Response) => {
  try {
    const user = (req as any).compatUser;
    const { phone, text, footer, buttons, secret_device: devicePhone } = req.body;
    if (!phone || !text || !buttons) {
      fail(res, 400, 'Fields "phone", "text", "buttons" are required'); return;
    }

    const deviceId = await resolveDevice(user.id, devicePhone);
    if (!deviceId) { fail(res, 400, 'No connected device found'); return; }
    if (!(await enforceQuota(res, user))) return;

    const btnJson = JSON.stringify({ text, footer, buttons });
    const result = await sendMessage(user.id, {
      deviceId, to: String(phone), type: MessageType.BUTTON, message: btnJson,
    });
    ok(res, { message: { id: result.id, to: phone, status: result.status } });
  } catch (err: any) { fail(res, err.status ?? 500, err.message); }
});

// ─── GET /blastify/check-number ─────────────────────────────────────────────────
compatRouter.get('/check-number', async (req: Request, res: Response) => {
  try {
    const user = (req as any).compatUser;
    const { phone, secret_device: devicePhone } = req.query as Record<string, string>;
    if (!phone) { fail(res, 400, 'Query param "phone" is required'); return; }

    const device = await prisma.device.findFirst({
      where: { userId: user.id, ...(devicePhone ? { phone: devicePhone } : {}), status: 'CONNECTED' },
    });
    if (!device) { fail(res, 400, 'No connected device found'); return; }

    const sock = getSession(device.id);
    if (!sock) { fail(res, 503, 'WhatsApp session not active'); return; }

    const phones = String(phone).split(',').map((p) => p.trim()).filter(Boolean);
    const results = await sock.onWhatsApp(...phones);

    const data = phones.map((p) => {
      const match = (results ?? []).find((r: any) => r.jid?.startsWith(p.replace(/\D/g, '')));
      return { phone: p, isWhatsApp: match?.exists ?? false, jid: match?.jid ?? null };
    });

    ok(res, { data });
  } catch (err: any) { fail(res, err.status ?? 500, err.message); }
});

// ─── GET /blastify/device ───────────────────────────────────────────────────────
compatRouter.get('/device', async (req: Request, res: Response) => {
  try {
    const user = (req as any).compatUser;
    const devices = await prisma.device.findMany({
      where: { userId: user.id },
      select: { id: true, name: true, phone: true, status: true, createdAt: true },
    });
    ok(res, { devices });
  } catch (err: any) { fail(res, err.status ?? 500, err.message); }
});
