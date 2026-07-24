import { prisma } from '../prisma/client';
import { renderWebhookTemplate, extractPhoneFromPayload } from '../utils/template';
import { toJID, formatPhone } from '../utils/jid';
import { getSession } from '../baileys/session';
import { logger } from '../config/logger';
import { getPlatformPreset } from '../integrations/platforms';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateIntegrationInput {
  name: string;
  platform?: string;
  deviceId: string;
  phoneField?: string;
  targetPhone?: string;
  messageTemplate: string;
  filterField?: string;
  filterValue?: string;
}

export interface UpdateIntegrationInput extends Partial<CreateIntegrationInput> {
  isActive?: boolean;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function listIntegrations(userId: string) {
  return prisma.integration.findMany({
    where: { userId },
    select: {
      id: true, name: true, platform: true, isActive: true,
      deviceId: true, phoneField: true, targetPhone: true,
      messageTemplate: true, filterField: true, filterValue: true,
      secretToken: true, createdAt: true, updatedAt: true,
      device: { select: { id: true, name: true, status: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getIntegration(userId: string, integrationId: string) {
  const integration = await prisma.integration.findFirst({
    where: { id: integrationId, userId },
    include: { device: { select: { id: true, name: true, status: true } } },
  });

  if (!integration) {
    const err = new Error('Integration not found') as any;
    err.status = 404; err.code = 'INTEGRATION_NOT_FOUND'; throw err;
  }
  return integration;
}

export async function createIntegration(userId: string, input: CreateIntegrationInput) {
  // Verify device belongs to user
  const device = await prisma.device.findFirst({
    where: { id: input.deviceId, userId },
  });
  if (!device) {
    const err = new Error('Device not found') as any;
    err.status = 404; err.code = 'DEVICE_NOT_FOUND'; throw err;
  }

  // Pembatasan platform integrasi per plan (mis. LITE hanya Google Sheets/Zoho/dst)
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true } });
  if (user) {
    const { checkPlatformAllowed } = await import('../middleware/plan.middleware');
    await checkPlatformAllowed(user.plan, input.platform ?? 'generic');
  }

  if (!input.phoneField && !input.targetPhone) {
    const err = new Error('Either phoneField or targetPhone is required') as any;
    err.status = 400; err.code = 'PHONE_SOURCE_REQUIRED'; throw err;
  }

  return prisma.integration.create({
    data: {
      userId,
      deviceId: input.deviceId,
      name: input.name,
      platform: input.platform ?? 'generic',
      messageTemplate: input.messageTemplate,
      phoneField: input.phoneField ?? null,
      targetPhone: input.targetPhone ?? null,
      filterField: input.filterField ?? null,
      filterValue: input.filterValue ?? null,
      signatureHeader: (input as any).signatureHeader ?? null,
      signatureSecret: (input as any).signatureSecret ?? null,
    },
    include: { device: { select: { id: true, name: true, status: true } } },
  });
}

export async function updateIntegration(
  userId: string,
  integrationId: string,
  input: UpdateIntegrationInput,
) {
  await getIntegration(userId, integrationId); // ownership check

  // Bila platform diganti, cek ulang apakah plan mengizinkan platform baru
  if (input.platform !== undefined) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true } });
    if (user) {
      const { checkPlatformAllowed } = await import('../middleware/plan.middleware');
      await checkPlatformAllowed(user.plan, input.platform);
    }
  }

  return prisma.integration.update({
    where: { id: integrationId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.platform !== undefined ? { platform: input.platform } : {}),
      ...(input.deviceId !== undefined ? { deviceId: input.deviceId } : {}),
      ...(input.phoneField !== undefined ? { phoneField: input.phoneField } : {}),
      ...(input.targetPhone !== undefined ? { targetPhone: input.targetPhone } : {}),
      ...(input.messageTemplate !== undefined ? { messageTemplate: input.messageTemplate } : {}),
      ...(input.filterField !== undefined ? { filterField: input.filterField } : {}),
      ...(input.filterValue !== undefined ? { filterValue: input.filterValue } : {}),
      ...((input as any).signatureHeader !== undefined ? { signatureHeader: (input as any).signatureHeader } : {}),
      ...((input as any).signatureSecret !== undefined ? { signatureSecret: (input as any).signatureSecret } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
    include: { device: { select: { id: true, name: true, status: true } } },
  });
}

export async function deleteIntegration(userId: string, integrationId: string): Promise<void> {
  await getIntegration(userId, integrationId); // ownership check
  await prisma.integration.delete({ where: { id: integrationId } });
}

export async function regenerateToken(userId: string, integrationId: string) {
  await getIntegration(userId, integrationId);
  const { randomUUID } = await import('crypto');
  const newToken = randomUUID().replace(/-/g, '');
  return prisma.integration.update({
    where: { id: integrationId },
    data: { secretToken: newToken },
    select: { id: true, secretToken: true },
  });
}

export async function getIntegrationLogs(
  userId: string,
  integrationId: string,
  limit = 50,
) {
  await getIntegration(userId, integrationId); // ownership check

  return prisma.integrationLog.findMany({
    where: { integrationId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true, status: true, phoneSent: true,
      renderedMessage: true, error: true, createdAt: true,
      rawPayload: true,
    },
  });
}

// ─── Webhook Processing ───────────────────────────────────────────────────────

/**
 * Process an incoming webhook payload for an integration (identified by secretToken).
 * - Looks up integration by secretToken
 * - Applies event filter (if configured)
 * - Extracts recipient phone from payload
 * - Renders message template
 * - Sends via active WhatsApp session
 * - Logs the attempt
 */
export async function processWebhook(secretToken: string, payload: any): Promise<void> {
  const integration = await prisma.integration.findUnique({
    where: { secretToken },
    include: { device: true },
  });

  if (!integration) {
    const maskedToken = `${secretToken.slice(0, 8)}****${secretToken.slice(-4)}`;
    logger.warn(`Webhook received for unknown token: ${maskedToken}`);
    return;
  }

  // ── Log helper ──────────────────────────────────────────────────────────────
  const writeLog = async (
    status: string,
    opts: { phone?: string; message?: string; error?: string } = {},
  ) => {
    await prisma.integrationLog.create({
      data: {
        integrationId: integration.id,
        rawPayload: payload,
        status,
        phoneSent: opts.phone ?? null,
        renderedMessage: opts.message ?? null,
        error: opts.error ?? null,
      },
    }).catch(() => null); // non-critical
  };

  // ── Inactive check ───────────────────────────────────────────────────────────
  if (!integration.isActive) {
    await writeLog('INACTIVE');
    return;
  }

  // ── Event filter ─────────────────────────────────────────────────────────────
  if (integration.filterField && integration.filterValue) {
    const actualValue = getNestedStr(payload, integration.filterField);
    if (actualValue !== integration.filterValue) {
      logger.debug(
        `Integration ${integration.id}: filtered out (${integration.filterField}=${actualValue}, expected ${integration.filterValue})`,
      );
      await writeLog('FILTERED', { error: `${integration.filterField}=${actualValue}` });
      return;
    }
  }

  // ── Resolve recipient phone ──────────────────────────────────────────────────
  let phone: string | null = null;

  if (integration.targetPhone) {
    phone = formatPhone(integration.targetPhone);
  } else if (integration.phoneField) {
    const raw = extractPhoneFromPayload(payload, integration.phoneField);
    phone = raw ? formatPhone(raw) : null;
  }

  if (!phone) {
    logger.warn(`Integration ${integration.id}: cannot extract phone from payload`);
    await writeLog('INVALID_PHONE', { error: 'Phone number not found in payload' });
    return;
  }

  // ── Render message ───────────────────────────────────────────────────────────
  const { applyFreeWatermark } = await import('../utils/watermark');
  const owner = await prisma.user.findUnique({
    where: { id: integration.userId },
    select: { plan: true },
  });
  const rendered = applyFreeWatermark(
    renderWebhookTemplate(integration.messageTemplate, payload),
    owner?.plan,
  );

  // ── Send via WhatsApp ────────────────────────────────────────────────────────
  const sock = getSession(integration.deviceId);
  if (!sock) {
    logger.warn(`Integration ${integration.id}: WhatsApp session not active for device ${integration.deviceId}`);
    await writeLog('FAILED', { phone, message: rendered, error: 'WhatsApp session not active' });
    return;
  }

  try {
    const jid = toJID(phone);
    await sock.sendMessage(jid, { text: rendered });

    logger.info(`Integration ${integration.id}: message sent to ${phone}`);
    await writeLog('SUCCESS', { phone, message: rendered });
  } catch (err: any) {
    logger.error(`Integration ${integration.id}: failed to send — ${err.message}`);
    await writeLog('FAILED', { phone, message: rendered, error: err.message });
  }
}

// Helper: extract nested string without phone-specific cleaning
function getNestedStr(obj: any, path: string): string | undefined {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = Array.isArray(current) ? current[Number(part)] : current[part];
  }
  return current != null ? String(current) : undefined;
}
