import { prisma } from '../prisma/client';
import { enqueueMessage } from '../queue/message.queue';
import { getNextDevice } from '../utils/device-rotation';
import { checkWarmupLimit } from './device.service';
import { emitToUser } from '../socket';
import { MessageType, BroadcastStatus } from '@prisma/client';
import { logger } from '../config/logger';

function throwNotFound(msg = 'Broadcast not found'): never {
  const err = new Error(msg) as any;
  err.status = 404; err.code = 'BROADCAST_NOT_FOUND'; throw err;
}

export async function listBroadcasts(userId: string, page = 1, limit = 20) {
  const where = { userId };
  const [broadcasts, total] = await Promise.all([
    prisma.broadcast.findMany({
      where, skip: (page - 1) * limit, take: limit,
      orderBy: { createdAt: 'desc' },
      include: { contactGroup: { select: { id: true, name: true } } },
    }),
    prisma.broadcast.count({ where }),
  ]);
  return { broadcasts, total };
}

export async function createBroadcast(
  userId: string,
  data: {
    name: string;
    deviceId?: string;
    contactGroupId?: string;
    type: MessageType;
    content: string;
    mediaUrl?: string;
    caption?: string;
    scheduledAt?: Date;
    delayMin?: number;
    delayMax?: number;
    variantBContent?: string;
    variantBMediaUrl?: string;
    variantBCaption?: string;
    variantBRatio?: number;
  },
) {
  // Pembatasan tipe pesan & jumlah broadcast per plan (mis. FREE hanya TEXT, max 3 broadcast)
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true } });
  if (user) {
    const { checkMessageTypeAllowed, checkBroadcastLimit } = await import('../middleware/plan.middleware');
    await checkMessageTypeAllowed(user.plan, data.type);
    await checkBroadcastLimit(userId, user.plan);
  }

  if (data.variantBRatio && data.variantBRatio > 0 && !data.variantBContent) {
    const err = new Error('variantBContent is required when variantBRatio > 0') as any;
    err.status = 400; err.code = 'VARIANT_B_CONTENT_REQUIRED'; throw err;
  }

  return prisma.broadcast.create({ data: { userId, ...data } });
}

/** Per-variant breakdown: sent/failed/delivered/read counts for an A/B broadcast. */
export async function getBroadcastVariantStats(userId: string, broadcastId: string) {
  const broadcast = await getBroadcast(userId, broadcastId);

  const grouped = await prisma.message.groupBy({
    by: ['variant', 'status'],
    where: { broadcastId },
    _count: true,
  });

  const variants: Record<string, Record<string, number>> = { A: {}, B: {} };
  for (const row of grouped) {
    const key = row.variant ?? 'A';
    if (!variants[key]) variants[key] = {};
    variants[key][row.status] = row._count;
  }

  const summarize = (counts: Record<string, number>) => {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const delivered = (counts.DELIVERED ?? 0) + (counts.READ ?? 0);
    return { total, ...counts, deliveryRate: total > 0 ? Math.round((delivered / total) * 1000) / 10 : 0 };
  };

  return {
    broadcastId,
    hasVariants: (broadcast as any).variantBRatio > 0,
    variantBRatio: (broadcast as any).variantBRatio ?? 0,
    A: summarize(variants.A ?? {}),
    B: summarize(variants.B ?? {}),
  };
}

export async function getBroadcast(userId: string, broadcastId: string) {
  const b = await prisma.broadcast.findFirst({
    where: { id: broadcastId, userId },
    include: { contactGroup: true, _count: { select: { messages: true } } },
  });
  if (!b) throwNotFound();
  return b;
}

export async function deleteBroadcast(userId: string, broadcastId: string) {
  const b = await prisma.broadcast.findFirst({ where: { id: broadcastId, userId } });
  if (!b) throwNotFound();
  if (b.status === 'RUNNING') {
    const err = new Error('Cannot delete a running broadcast') as any;
    err.status = 400; err.code = 'BROADCAST_RUNNING'; throw err;
  }
  await prisma.broadcast.delete({ where: { id: broadcastId } });
}

/** Start sending a broadcast — enqueues one BullMQ job per contact */
export async function startBroadcast(userId: string, broadcastId: string): Promise<void> {
  const broadcast = await prisma.broadcast.findFirst({ where: { id: broadcastId, userId } });
  if (!broadcast) throwNotFound();

  if (!['DRAFT', 'PAUSED'].includes(broadcast.status)) {
    const err = new Error(`Broadcast is already ${broadcast.status}`) as any;
    err.status = 400; err.code = 'BROADCAST_INVALID_STATE'; throw err;
  }

  // Resolve recipients from contact group OR from custom list
  let recipients: Array<{ name: string; phone: string; variables: any }> = [];

  if (broadcast.contactGroupId) {
    const members = await prisma.contactGroupMember.findMany({
      where: { groupId: broadcast.contactGroupId },
      include: { contact: true },
    });
    recipients = members.map((m) => ({
      name: m.contact.name,
      phone: m.contact.phone,
      variables: m.contact.variables,
    }));
  }

  if (recipients.length === 0) {
    const err = new Error('No recipients found for this broadcast') as any;
    err.status = 400; err.code = 'NO_RECIPIENTS'; throw err;
  }

  await prisma.broadcast.update({
    where: { id: broadcastId },
    data: { status: BroadcastStatus.RUNNING, startedAt: new Date(), totalCount: recipients.length },
  });

  // Plan pemilik broadcast — dipakai worker untuk watermark FREE plan
  const owner = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true } });

  // Enqueue in background to avoid blocking the HTTP response
  setImmediate(async () => {
    let sentCount = 0;
    let failedCount = 0;
    const delayMin = broadcast.delayMin ?? 1000;
    const delayMax = broadcast.delayMax ?? 3000;

    for (const [i, recipient] of recipients.entries()) {
      try {
        // Device rotation: use fixed device or pick next connected device
        const deviceId =
          broadcast.deviceId ?? (await getNextDevice(userId)) ?? broadcast.deviceId ?? '';

        if (!deviceId) { failedCount++; continue; }

        try {
          await checkWarmupLimit(deviceId);
        } catch (warmupErr: any) {
          logger.warn(`Broadcast ${broadcastId}: skipped ${recipient.phone} — ${warmupErr.message}`);
          failedCount++;
          continue;
        }

        // A/B testing: randomly assign each recipient to variant A or B
        const useVariantB =
          broadcast.variantBRatio > 0 &&
          Boolean(broadcast.variantBContent) &&
          Math.random() * 100 < broadcast.variantBRatio;
        const variant = broadcast.variantBRatio > 0 ? (useVariantB ? 'B' : 'A') : null;
        const content = useVariantB ? broadcast.variantBContent! : broadcast.content;
        const mediaUrl = useVariantB ? broadcast.variantBMediaUrl ?? undefined : broadcast.mediaUrl ?? undefined;
        const caption = useVariantB ? broadcast.variantBCaption ?? undefined : broadcast.caption ?? undefined;

        const message = await prisma.message.create({
          data: {
            userId,
            deviceId,
            broadcastId,
            to: recipient.phone,
            type: broadcast.type,
            content,
            mediaUrl,
            caption,
            variant,
            status: 'QUEUED',
          },
        });

        const delay = i * (delayMin + Math.random() * (delayMax - delayMin));

        await enqueueMessage({
          messageId: message.id,
          deviceId,
          userId,
          to: recipient.phone,
          type: broadcast.type,
          content,
          mediaUrl,
          caption,
          userPlan: owner?.plan,
        }, delay);

        sentCount++;
      } catch (err: any) {
        logger.error(`Broadcast ${broadcastId} failed for ${recipient.phone}: ${err.message}`);
        failedCount++;
      }

      // Emit realtime progress after each message
      emitToUser(userId, 'broadcast:progress', {
        broadcastId,
        total: recipients.length,
        sent: sentCount,
        failed: failedCount,
        current: i + 1,
        percent: Math.round(((i + 1) / recipients.length) * 100),
      });
    }

    const finalStatus =
      failedCount === recipients.length ? BroadcastStatus.FAILED : BroadcastStatus.FINISHED;

    await prisma.broadcast.update({
      where: { id: broadcastId },
      data: { status: finalStatus, finishedAt: new Date(), sentCount, failedCount },
    });

    // Final emit
    emitToUser(userId, 'broadcast:progress', {
      broadcastId,
      total: recipients.length,
      sent: sentCount,
      failed: failedCount,
      current: recipients.length,
      percent: 100,
      status: finalStatus,
    });

    logger.info(`Broadcast ${broadcastId} done: ${sentCount} sent, ${failedCount} failed`);
  });
}

export async function pauseBroadcast(userId: string, broadcastId: string) {
  const b = await prisma.broadcast.findFirst({ where: { id: broadcastId, userId } });
  if (!b) throwNotFound();
  return prisma.broadcast.update({
    where: { id: broadcastId },
    data: { status: BroadcastStatus.PAUSED },
  });
}

/** Resume = same as start, only allowed from PAUSED state */
export async function resumeBroadcast(userId: string, broadcastId: string) {
  return startBroadcast(userId, broadcastId); // startBroadcast already handles PAUSED state
}

/** Per-number log: list all messages belonging to a broadcast */
export async function getBroadcastLogs(
  userId: string,
  broadcastId: string,
  page = 1,
  limit = 50,
  status?: string,
) {
  const broadcast = await prisma.broadcast.findFirst({ where: { id: broadcastId, userId } });
  if (!broadcast) throwNotFound();

  const where: any = { broadcastId };
  if (status) where.status = status;

  const [messages, total] = await Promise.all([
    prisma.message.findMany({
      where,
      select: {
        id: true,
        to: true,
        status: true,
        waMessageId: true,
        errorMessage: true,
        sentAt: true,
        createdAt: true,
      },
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'asc' },
    }),
    prisma.message.count({ where }),
  ]);

  return { messages, total };
}
