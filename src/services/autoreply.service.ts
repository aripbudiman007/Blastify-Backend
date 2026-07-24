import { prisma } from '../prisma/client';
import { KeywordMatchType, MessageType } from '@prisma/client';
import { matchesKeyword } from '../utils/keyword-match';

function throwNotFound(msg = 'Auto-reply not found'): never {
  const err = new Error(msg) as any;
  err.status = 404; err.code = 'AUTOREPLY_NOT_FOUND'; throw err;
}

export async function listAutoReplies(userId: string, deviceId?: string) {
  return prisma.autoReply.findMany({
    where: { userId, ...(deviceId ? { deviceId } : {}) },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
  });
}

export async function createAutoReply(
  userId: string,
  data: {
    deviceId: string;
    name: string;
    keyword: string;
    matchType?: KeywordMatchType;
    replyType?: MessageType;
    replyContent: string;
    replyMediaUrl?: string;
    priority?: number;
  },
) {
  const device = await prisma.device.findFirst({ where: { id: data.deviceId, userId } });
  if (!device) {
    const err = new Error('Device not found') as any;
    err.status = 404; err.code = 'DEVICE_NOT_FOUND'; throw err;
  }
  return prisma.autoReply.create({ data: { userId, ...data } });
}

export async function updateAutoReply(
  userId: string,
  id: string,
  data: Partial<{
    name: string; keyword: string; matchType: KeywordMatchType;
    replyType: MessageType; replyContent: string;
    replyMediaUrl: string; isActive: boolean; priority: number;
  }>,
) {
  const existing = await prisma.autoReply.findFirst({ where: { id, userId } });
  if (!existing) throwNotFound();
  return prisma.autoReply.update({ where: { id }, data });
}

export async function deleteAutoReply(userId: string, id: string) {
  const existing = await prisma.autoReply.findFirst({ where: { id, userId } });
  if (!existing) throwNotFound();
  await prisma.autoReply.delete({ where: { id } });
}

/**
 * Match incoming message text against all active auto-replies for a device.
 * Returns the highest-priority matching rule, or null.
 */
export async function findMatchingReply(deviceId: string, text: string) {
  const rules = await prisma.autoReply.findMany({
    where: { deviceId, isActive: true },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
  });

  for (const rule of rules) {
    if (matchesKeyword(text, rule.keyword, rule.matchType)) return rule;
  }
  return null;
}
