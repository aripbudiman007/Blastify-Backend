import { Worker, Job } from 'bullmq';
import { getRedisClient } from '../redis/client';
import { getSession } from '../baileys/session';
import { prisma } from '../prisma/client';
import { logger } from '../config/logger';
import { config } from '../config';
import { toJID, formatPhone } from '../utils/jid';
import { dispatch } from '../webhook/dispatcher';
import { renderTemplate } from '../utils/template';
import type { MessageJobData } from './message.queue';
import { AnyMessageContent, proto } from '@whiskeysockets/baileys';
import { applyFreeWatermark } from '../utils/watermark';
import { getWarmupStage } from '../utils/warmup';

function randomDelay(minMs?: number, maxMs?: number): Promise<void> {
  const min = minMs ?? config.MESSAGE_DELAY_MIN_MS;
  const max = maxMs ?? config.MESSAGE_DELAY_MAX_MS;
  const ms = min + Math.random() * (max - min);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Returns true if current time is within device working hours */
function isWithinWorkingHours(
  workingHoursStart: number | null,
  workingHoursEnd: number | null,
  workingDays: number[],
): boolean {
  if (workingHoursStart == null || workingHoursEnd == null) return true; // no restriction
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const hour = now.getHours();
  if (workingDays.length > 0 && !workingDays.includes(day)) return false;
  return hour >= workingHoursStart && hour < workingHoursEnd;
}

function buildMessageContent(job: MessageJobData): AnyMessageContent {
  const linkPreview = job.linkPreview === false ? null : undefined;
  const text = applyFreeWatermark(job.content, job.userPlan);

  switch (job.type) {
    case 'TEXT':
    case 'TEMPLATE':
      return { text, linkPreview } as any;

    case 'IMAGE':
      return {
        image: { url: job.mediaUrl! },
        caption: applyFreeWatermark(job.caption ?? job.content, job.userPlan),
      };

    case 'VIDEO':
      return {
        video: { url: job.mediaUrl! },
        caption: applyFreeWatermark(job.caption ?? job.content, job.userPlan),
      };

    case 'AUDIO':
      return {
        audio: { url: job.mediaUrl! },
        mimetype: 'audio/mpeg',
        ptt: false,
      };

    case 'DOCUMENT':
      return {
        document: { url: job.mediaUrl! },
        fileName: job.caption ?? job.content,
        mimetype: 'application/octet-stream',
      };

    case 'LOCATION': {
      const [lat, lng] = job.content.split(',').map(Number);
      return { location: { degreesLatitude: lat, degreesLongitude: lng } };
    }

    case 'LIST': {
      // content is JSON: { title, text, footer, buttonText, sections }
      const listData = JSON.parse(job.content);
      return {
        listMessage: {
          title: listData.title ?? '',
          text: listData.text ?? '',
          footerText: listData.footer ?? '',
          buttonText: listData.buttonText ?? 'Pilih',
          listType: proto.Message.ListMessage.ListType.SINGLE_SELECT,
          sections: (listData.sections ?? []).map((s: any) => ({
            title: s.title ?? '',
            rows: (s.rows ?? []).map((r: any) => ({
              title: r.title ?? '',
              rowId: r.id ?? r.rowId ?? String(Math.random()),
              description: r.description ?? '',
            })),
          })),
        },
      } as any;
    }

    case 'BUTTON': {
      // content is JSON: { text, footer, buttons: [{id, text}] }
      const btnData = JSON.parse(job.content);
      return {
        buttons: (btnData.buttons ?? []).map((b: any, i: number) => ({
          buttonId: b.id ?? String(i + 1),
          buttonText: { displayText: b.text ?? `Option ${i + 1}` },
          type: 1,
        })),
        text: btnData.text ?? '',
        footer: btnData.footer ?? '',
        headerType: 1,
      } as any;
    }

    default:
      return { text: job.content } as any;
  }
}

async function processMessage(job: Job<MessageJobData>): Promise<void> {
  const { messageId, deviceId, to } = job.data;

  logger.info(`Processing message job ${messageId} → ${to} via device ${deviceId}`);

  // Fetch device settings for working hours + delay + human behavior
  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: {
      minDelay: true, maxDelay: true,
      workingHoursStart: true, workingHoursEnd: true, workingDays: true,
      typingIndicator: true,
      warmupEnabled: true, warmupStartedAt: true,
    },
  });

  // Check working hours
  if (device && !isWithinWorkingHours(
    device.workingHoursStart,
    device.workingHoursEnd,
    device.workingDays,
  )) {
    throw new Error(`Device ${deviceId} is outside working hours — message will retry`);
  }

  // Warm-up: slow the per-message delay down proportionally during the ramp
  // period (daily volume cap is enforced earlier, at enqueue time).
  const warmupMultiplier =
    device?.warmupEnabled && device.warmupStartedAt
      ? getWarmupStage(device.warmupStartedAt).delayMultiplier
      : 1;

  const baseMinDelay = job.data.minDelay ?? device?.minDelay;
  const baseMaxDelay = job.data.maxDelay ?? device?.maxDelay;

  // Apply per-device random delay (anti-ban)
  await randomDelay(
    baseMinDelay != null ? Math.round(baseMinDelay * warmupMultiplier) : undefined,
    baseMaxDelay != null ? Math.round(baseMaxDelay * warmupMultiplier) : undefined,
  );

  const sock = getSession(deviceId);
  if (!sock) {
    throw new Error(`Session for device ${deviceId} is not active`);
  }

  const jid = toJID(to);

  // Resolve contact variables for template substitution
  const contact = await prisma.contact.findFirst({
    where: { userId: job.data.userId, phone: formatPhone(to) },
  }).catch(() => null);

  const vars: Record<string, string> = {
    phone: formatPhone(to),
    name: contact?.name ?? formatPhone(to),
    ...((contact?.variables as Record<string, string>) ?? {}),
  };

  const resolvedJob: typeof job.data = {
    ...job.data,
    content: renderTemplate(job.data.content, vars),
    caption: job.data.caption ? renderTemplate(job.data.caption, vars) : job.data.caption,
  };

  const content = buildMessageContent(resolvedJob);

  // ── Typing indicator simulation ───────────────────────────────────────────
  if (device?.typingIndicator) {
    try {
      // Show as online first
      await sock.sendPresenceUpdate('available', jid);

      // Show "typing..." indicator
      await sock.sendPresenceUpdate('composing', jid);

      // Simulate realistic typing duration based on message length.
      // Human typing speed ≈ 200-300 chars/min (3-5 chars/sec).
      // We aim for ~40ms/char with ±30% random variance, capped 1–10s.
      const charCount = resolvedJob.content.length;
      const baseMs = Math.min(Math.max(charCount * 40, 1_000), 10_000);
      const variance = baseMs * 0.3 * (Math.random() * 2 - 1); // ±30%
      const typingMs = Math.round(baseMs + variance);

      await new Promise((r) => setTimeout(r, typingMs));

      // Stop typing before sending (brief "thinking" pause)
      await sock.sendPresenceUpdate('paused', jid);
      await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));
    } catch (e) {
      // Non-critical — continue even if presence update fails
      logger.debug(`Presence update failed for ${jid}: ${(e as Error).message}`);
    }
  }
  // ── End typing indicator ──────────────────────────────────────────────────

  const result = await sock.sendMessage(jid, content);
  const waMessageId = result?.key?.id ?? null;

  await prisma.message.update({
    where: { id: messageId },
    data: {
      status: 'SENT',
      waMessageId,
      sentAt: new Date(),
    },
  });

  await dispatch('message.sent', deviceId, {
    messageId,
    waMessageId,
    to,
    type: job.data.type,
  });

  logger.info(`Message ${messageId} sent successfully (waId: ${waMessageId})`);
}

async function handleFailure(job: Job<MessageJobData>, err: Error): Promise<void> {
  logger.error(`Message job ${job.data.messageId} failed: ${err.message}`);

  const isLastAttempt = job.attemptsMade >= (job.opts.attempts ?? 3);

  if (isLastAttempt) {
    await prisma.message.update({
      where: { id: job.data.messageId },
      data: {
        status: 'FAILED',
        errorMessage: err.message,
        retries: job.attemptsMade,
      },
    });
  } else {
    await prisma.message.update({
      where: { id: job.data.messageId },
      data: { retries: job.attemptsMade },
    });
  }
}

let worker: Worker<MessageJobData> | null = null;

export function startMessageWorker(): Worker<MessageJobData> {
  if (worker) return worker;

  worker = new Worker<MessageJobData>(
    'wa-messages',
    async (job) => {
      await processMessage(job);
    },
    {
      connection: getRedisClient(),
      concurrency: 1,
    },
  );

  worker.on('completed', (job) => {
    logger.debug(`Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    if (job) handleFailure(job, err);
  });

  logger.info('Message worker started');
  return worker;
}

export async function stopMessageWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    logger.info('Message worker stopped');
  }
}
