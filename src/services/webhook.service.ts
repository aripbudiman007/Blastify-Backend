import { prisma } from '../prisma/client';
import { generateSecret } from '../utils/crypto';
import { dispatchTest } from '../webhook/dispatcher';

const VALID_EVENTS = [
  'message.received',
  'message.sent',
  'message.delivered',
  'message.read',
  'device.connected',
  'device.disconnected',
  'device.qr',
] as const;

function throwNotFound(msg: string): never {
  const err = new Error(msg) as any;
  err.status = 404;
  err.code = 'WEBHOOK_NOT_FOUND';
  throw err;
}

export async function listWebhooks(userId: string) {
  return prisma.webhook.findMany({
    where: { userId },
    include: { devices: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createWebhook(
  userId: string,
  data: { url: string; events: string[]; deviceIds?: string[] },
) {
  const validEvents = data.events.filter((e) =>
    (VALID_EVENTS as readonly string[]).includes(e),
  );

  const webhook = await prisma.webhook.create({
    data: {
      userId,
      url: data.url,
      secret: generateSecret(),
      events: validEvents,
      devices:
        data.deviceIds && data.deviceIds.length > 0
          ? {
              connect: data.deviceIds.map((id) => ({ id })),
            }
          : undefined,
    },
    include: { devices: { select: { id: true, name: true } } },
  });

  return webhook;
}

export async function updateWebhook(
  userId: string,
  webhookId: string,
  data: { url?: string; events?: string[]; isActive?: boolean; deviceIds?: string[] },
) {
  const existing = await prisma.webhook.findFirst({ where: { id: webhookId, userId } });
  if (!existing) throwNotFound('Webhook not found');

  const webhook = await prisma.webhook.update({
    where: { id: webhookId },
    data: {
      ...(data.url ? { url: data.url } : {}),
      ...(data.events
        ? {
            events: data.events.filter((e) =>
              (VALID_EVENTS as readonly string[]).includes(e),
            ),
          }
        : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      ...(data.deviceIds !== undefined
        ? { devices: { set: data.deviceIds.map((id) => ({ id })) } }
        : {}),
    },
    include: { devices: { select: { id: true, name: true } } },
  });

  return webhook;
}

export async function deleteWebhook(userId: string, webhookId: string): Promise<void> {
  const existing = await prisma.webhook.findFirst({ where: { id: webhookId, userId } });
  if (!existing) throwNotFound('Webhook not found');

  await prisma.device.updateMany({
    where: { webhookId },
    data: { webhookId: null },
  });

  await prisma.webhook.delete({ where: { id: webhookId } });
}

export async function testWebhook(userId: string, webhookId: string): Promise<boolean> {
  const existing = await prisma.webhook.findFirst({ where: { id: webhookId, userId } });
  if (!existing) throwNotFound('Webhook not found');

  return dispatchTest(webhookId);
}
