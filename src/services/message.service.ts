import { prisma } from '../prisma/client';
import { enqueueMessage } from '../queue/message.queue';
import { MessageType } from '@prisma/client';

export interface SendMessageInput {
  deviceId: string;
  to: string;
  type: MessageType;
  message?: string;
  url?: string;
  caption?: string;
  scheduledAt?: Date;
  latitude?: number;
  longitude?: number;
  linkPreview?: boolean;
}

function throwNotFound(msg: string, code: string): never {
  const err = new Error(msg) as any;
  err.status = 404;
  err.code = code;
  throw err;
}

function throwBadRequest(msg: string, code: string): never {
  const err = new Error(msg) as any;
  err.status = 400;
  err.code = code;
  throw err;
}

export async function sendMessage(userId: string, input: SendMessageInput) {
  const device = await prisma.device.findFirst({
    where: { id: input.deviceId, userId },
    select: { id: true, status: true, minDelay: true, maxDelay: true },
  });

  // Fetch user plan for watermark injection
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true } });

  if (!device) throwNotFound('Device not found', 'DEVICE_NOT_FOUND');
  if (device.status !== 'CONNECTED') {
    throwBadRequest('Device is not connected', 'DEVICE_NOT_CONNECTED');
  }

  const { checkWarmupLimit } = await import('./device.service');
  await checkWarmupLimit(input.deviceId);

  // Pembatasan tipe pesan per plan (mis. FREE hanya TEXT)
  if (user) {
    const { checkMessageTypeAllowed } = await import('../middleware/plan.middleware');
    await checkMessageTypeAllowed(user.plan, input.type);
  }

  let content: string;
  if (input.type === 'LOCATION') {
    content = `${input.latitude},${input.longitude}`;
  } else if (input.message) {
    content = input.message;
  } else if (input.caption) {
    content = input.caption;
  } else {
    throwBadRequest(
      `Field "message" is required for type "${input.type}"`,
      'MISSING_MESSAGE_CONTENT',
    );
  }

  const message = await prisma.message.create({
    data: {
      userId,
      deviceId: input.deviceId,
      to: input.to,
      type: input.type,
      content,
      mediaUrl: input.url,
      caption: input.caption,
      status: 'PENDING',
      scheduledAt: input.scheduledAt,
    },
  });

  const delay = input.scheduledAt
    ? Math.max(0, input.scheduledAt.getTime() - Date.now())
    : undefined;

  await enqueueMessage(
    {
      messageId: message.id,
      deviceId: input.deviceId,
      userId,
      to: input.to,
      type: input.type,
      content,
      mediaUrl: input.url,
      caption: input.caption,
      minDelay: device!.minDelay,
      maxDelay: device!.maxDelay,
      linkPreview: input.linkPreview,
      userPlan: user?.plan,
    },
    delay,
  );

  await prisma.message.update({ where: { id: message.id }, data: { status: 'QUEUED' } });

  return message;
}

export async function sendBulkMessages(
  userId: string,
  inputs: SendMessageInput[],
) {
  const results = await Promise.allSettled(inputs.map((input) => sendMessage(userId, input)));

  return results.map((r, i) => ({
    to: inputs[i].to,
    success: r.status === 'fulfilled',
    messageId: r.status === 'fulfilled' ? r.value.id : undefined,
    error: r.status === 'rejected' ? r.reason?.message : undefined,
  }));
}

export async function listMessages(
  userId: string,
  filters: {
    deviceId?: string;
    status?: string;
    from?: Date;
    to?: Date;
    page: number;
    limit: number;
  },
) {
  const where: any = { userId };
  if (filters.deviceId) where.deviceId = filters.deviceId;
  if (filters.status) where.status = filters.status;
  if (filters.from || filters.to) {
    where.createdAt = {};
    if (filters.from) where.createdAt.gte = filters.from;
    if (filters.to) where.createdAt.lte = filters.to;
  }

  const [messages, total] = await Promise.all([
    prisma.message.findMany({
      where,
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.message.count({ where }),
  ]);

  return { messages, total };
}

export async function getMessageDetail(userId: string, messageId: string) {
  const message = await prisma.message.findFirst({ where: { id: messageId, userId } });
  if (!message) throwNotFound('Message not found', 'MESSAGE_NOT_FOUND');
  return message;
}

export async function listScheduledMessages(userId: string, deviceId?: string) {
  return prisma.message.findMany({
    where: {
      userId,
      ...(deviceId ? { deviceId } : {}),
      scheduledAt: { not: null, gt: new Date() },
      status: { in: ['PENDING', 'QUEUED'] },
    },
    orderBy: { scheduledAt: 'asc' },
  });
}

export async function cancelMessage(userId: string, messageId: string) {
  const message = await prisma.message.findFirst({ where: { id: messageId, userId } });
  if (!message) throwNotFound('Message not found', 'MESSAGE_NOT_FOUND');

  if (!['PENDING', 'QUEUED'].includes(message.status)) {
    throwBadRequest(
      `Cannot cancel message with status "${message.status}". Only PENDING/QUEUED can be cancelled.`,
      'CANNOT_CANCEL',
    );
  }

  // Remove from BullMQ queue
  try {
    const { getMessageQueue } = await import('../queue/message.queue');
    const queue = getMessageQueue();
    const job = await queue.getJob(messageId);
    if (job) await job.remove();
  } catch {
    // Job may already be processing — continue with DB update
  }

  return prisma.message.update({
    where: { id: messageId },
    data: { status: 'FAILED', errorMessage: 'Cancelled by user' },
  });
}
