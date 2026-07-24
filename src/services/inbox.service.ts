import { prisma } from '../prisma/client';

export interface InboxFilter {
  deviceId?: string;
  from?: string;
  isRead?: boolean;
  isGroup?: boolean;
  dateFrom?: Date;
  dateTo?: Date;
  page?: number;
  limit?: number;
}

export async function listInbox(userId: string, filter: InboxFilter = {}) {
  const { deviceId, from, isRead, isGroup, dateFrom, dateTo, page = 1, limit = 30 } = filter;
  const skip = (page - 1) * limit;

  const where: any = { userId };
  if (deviceId) where.deviceId = deviceId;
  if (from) where.from = { contains: from };
  if (isRead !== undefined) where.isRead = isRead;
  if (isGroup !== undefined) where.isGroup = isGroup;
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = dateFrom;
    if (dateTo) where.createdAt.lte = dateTo;
  }

  const [total, data] = await Promise.all([
    prisma.incomingMessage.count({ where }),
    prisma.incomingMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true, deviceId: true, from: true, pushName: true,
        type: true, content: true, mediaUrl: true, isRead: true,
        isGroup: true, groupId: true, waMessageId: true, repliedWith: true,
        createdAt: true,
      },
    }),
  ]);

  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
}

/** Grouped conversations — one row per unique sender */
export async function listConversations(userId: string, deviceId?: string) {
  const where: any = { userId, isGroup: false };
  if (deviceId) where.deviceId = deviceId;

  // Get all distinct senders with their latest message
  const rows = await prisma.incomingMessage.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: {
      from: true, pushName: true, deviceId: true,
      content: true, createdAt: true, isRead: true,
    },
  });

  // Deduplicate — keep only latest per (from + deviceId)
  const seen = new Map<string, typeof rows[number]>();
  const unreadCount = new Map<string, number>();

  for (const row of rows) {
    const key = `${row.deviceId}:${row.from}`;
    if (!seen.has(key)) seen.set(key, row);
    if (!row.isRead) unreadCount.set(key, (unreadCount.get(key) ?? 0) + 1);
  }

  return Array.from(seen.entries()).map(([key, row]) => ({
    from: row.from,
    pushName: row.pushName,
    deviceId: row.deviceId,
    lastMessage: row.content,
    lastMessageAt: row.createdAt,
    unreadCount: unreadCount.get(key) ?? 0,
  }));
}

/** All messages from a specific sender */
export async function getConversation(userId: string, from: string, deviceId?: string) {
  const where: any = { userId, from };
  if (deviceId) where.deviceId = deviceId;

  return prisma.incomingMessage.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, deviceId: true, from: true, pushName: true,
      type: true, content: true, mediaUrl: true, isRead: true,
      isGroup: true, groupId: true, waMessageId: true, repliedWith: true,
      createdAt: true,
    },
  });
}

export async function markAsRead(userId: string, id: string) {
  const msg = await prisma.incomingMessage.findFirst({ where: { id, userId } });
  if (!msg) {
    const err = new Error('Message not found') as any;
    err.status = 404; err.code = 'NOT_FOUND'; throw err;
  }
  return prisma.incomingMessage.update({
    where: { id },
    data: { isRead: true },
  });
}

export async function markAllRead(userId: string, deviceId?: string) {
  const where: any = { userId, isRead: false };
  if (deviceId) where.deviceId = deviceId;
  const result = await prisma.incomingMessage.updateMany({ where, data: { isRead: true } });
  return { updated: result.count };
}

export async function deleteIncoming(userId: string, id: string) {
  const msg = await prisma.incomingMessage.findFirst({ where: { id, userId } });
  if (!msg) {
    const err = new Error('Message not found') as any;
    err.status = 404; err.code = 'NOT_FOUND'; throw err;
  }
  await prisma.incomingMessage.delete({ where: { id } });
}
