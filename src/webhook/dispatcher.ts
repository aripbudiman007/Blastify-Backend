import axios from 'axios';
import crypto from 'crypto';
import { prisma } from '../prisma/client';
import { logger } from '../config/logger';
import { config } from '../config';

const RETRY_DELAYS_MS = [5_000, 10_000, 30_000];

function signPayload(secret: string, body: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

async function sendWebhook(
  url: string,
  secret: string,
  payload: object,
  attempt = 0,
): Promise<void> {
  const body = JSON.stringify(payload);
  const signature = signPayload(secret, body);

  try {
    await axios.post(url, payload, {
      timeout: config.WEBHOOK_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        'X-Gateway-Signature': signature,
        'X-Gateway-Event': (payload as any).event,
      },
    });
    logger.debug(`Webhook dispatched to ${url} (attempt ${attempt + 1})`);
  } catch (err: any) {
    const status = err.response?.status;
    logger.warn(`Webhook failed to ${url} [${status ?? err.code}] (attempt ${attempt + 1})`);

    if (attempt < config.WEBHOOK_MAX_RETRIES - 1) {
      const delay = RETRY_DELAYS_MS[attempt] ?? 30_000;
      logger.info(`Retrying webhook to ${url} in ${delay}ms`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      await sendWebhook(url, secret, payload, attempt + 1);
    } else {
      logger.error(`Webhook permanently failed to ${url} after ${attempt + 1} attempts`);
    }
  }
}

export async function dispatch(
  event: string,
  deviceId: string,
  data: object,
): Promise<void> {
  try {
    const device = await prisma.device.findUnique({
      where: { id: deviceId },
      include: { webhook: true },
    });

    if (!device?.webhook) return;
    const webhook = device.webhook;

    if (!webhook.isActive) return;
    if (!webhook.events.includes(event)) return;

    const payload = {
      event,
      deviceId,
      timestamp: Math.floor(Date.now() / 1000),
      data,
    };

    setImmediate(() => {
      sendWebhook(webhook.url, webhook.secret, payload).catch((err) =>
        logger.error(`Webhook dispatch error: ${err.message}`),
      );
    });
  } catch (err: any) {
    logger.error(`dispatch error for event ${event}: ${err.message}`);
  }
}

export async function dispatchTest(webhookId: string): Promise<boolean> {
  const webhook = await prisma.webhook.findUnique({ where: { id: webhookId } });
  if (!webhook) return false;

  const payload = {
    event: 'webhook.test',
    deviceId: null,
    timestamp: Math.floor(Date.now() / 1000),
    data: { message: 'This is a test webhook from WA Gateway' },
  };

  try {
    await sendWebhook(webhook.url, webhook.secret, payload);
    return true;
  } catch {
    return false;
  }
}
