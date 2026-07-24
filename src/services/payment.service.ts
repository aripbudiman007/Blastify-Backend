import axios from 'axios';
import crypto from 'crypto';
import { config } from '../config';
import { logger } from '../config/logger';
import { prisma } from '../prisma/client';
import { calcPlanExpiry } from '../jobs/subscription-check.job';
import { sendInvoicePaidEmail } from './email.service';
import { logAudit } from '../utils/audit';

export type PaymentProvider = 'ipaymu' | 'midtrans';

export function getActivePaymentProvider(): PaymentProvider | null {
  if (config.PAYMENT_PROVIDER === 'ipaymu' && config.IPAYMU_VA && config.IPAYMU_API_KEY) {
    return 'ipaymu';
  }
  if (config.PAYMENT_PROVIDER === 'midtrans' && config.MIDTRANS_SERVER_KEY) {
    return 'midtrans';
  }
  // Fallback: pakai provider mana pun yang kredensialnya terisi
  if (config.IPAYMU_VA && config.IPAYMU_API_KEY) return 'ipaymu';
  if (config.MIDTRANS_SERVER_KEY) return 'midtrans';
  return null;
}

export function isPaymentGatewayEnabled(): boolean {
  return getActivePaymentProvider() !== null;
}

interface InvoiceForPayment {
  id: string;
  amount: number; // IDR dalam sen
  plan: string;
  user: { name: string; email: string };
}

/**
 * Create a hosted-payment transaction on the active provider.
 * Returns the redirect URL the user should open to pay.
 */
export async function createPaymentTransaction(
  invoice: InvoiceForPayment,
): Promise<{ redirectUrl: string; token?: string }> {
  const provider = getActivePaymentProvider();
  if (provider === 'ipaymu') {
    const r = await createIpaymuPayment(invoice);
    return { redirectUrl: r.redirectUrl, token: r.sessionId };
  }
  if (provider === 'midtrans') {
    const r = await createSnapTransaction(invoice);
    return { redirectUrl: r.redirectUrl, token: r.token };
  }
  throw new Error('No payment gateway configured');
}

/**
 * Shared settlement: mark invoice PAID, activate the plan, audit, email.
 * Idempotent — an already-PAID invoice is never processed twice.
 */
async function settleInvoice(
  invoice: {
    id: string;
    userId: string;
    plan: any;
    amount: number;
    status: string;
    user: { name: string; email: string; planExpiresAt: Date | null };
  },
  paymentMethod: string | null,
  auditAction: string,
): Promise<{ status: string }> {
  const now = new Date();
  const planExpiresAt = calcPlanExpiry(invoice.user.planExpiresAt);

  // Atomically update invoice ONLY if still PENDING (idempotent settlement).
  // If invoice was already PAID, count will be 0 and we return early.
  const { count: updatedCount } = await prisma.invoice.updateMany({
    where: { id: invoice.id, status: 'PENDING' },
    data: { status: 'PAID', paidAt: now, paymentMethod },
  });

  if (updatedCount === 0) {
    // Invoice either not found or already paid — safe to return without re-processing
    return { status: 'already_paid' };
  }

  // Now activate user's plan in a separate transaction
  await prisma.user.update({
    where: { id: invoice.userId },
    data: { plan: invoice.plan, planActivatedAt: now, planExpiresAt },
  });

  logAudit({
    actorType: 'user',
    actorId: invoice.userId,
    actorEmail: invoice.user.email,
    action: auditAction,
    targetType: 'invoice',
    targetId: invoice.id,
    metadata: { plan: invoice.plan, amount: invoice.amount, paymentMethod },
  });

  void sendInvoicePaidEmail(
    invoice.user.email,
    invoice.user.name,
    invoice.id,
    invoice.plan,
    invoice.amount,
    planExpiresAt,
    invoice.userId,
  );

  logger.info(`Invoice ${invoice.id} PAID (${paymentMethod ?? 'unknown'}) — plan ${invoice.plan} activated for user ${invoice.userId}`);
  return { status: 'paid' };
}

// ─── iPaymu ───────────────────────────────────────────────────────────────────

function ipaymuBaseUrl(): string {
  return config.IPAYMU_IS_PRODUCTION
    ? 'https://my.ipaymu.com/api/v2'
    : 'https://sandbox.ipaymu.com/api/v2';
}

/**
 * iPaymu v2 signature:
 * HMAC-SHA256("{METHOD}:{VA}:{sha256(jsonBody) lowercase}:{apiKey}", apiKey)
 */
function ipaymuSignature(method: string, jsonBody: string): string {
  const bodyHash = crypto.createHash('sha256').update(jsonBody).digest('hex').toLowerCase();
  const stringToSign = `${method.toUpperCase()}:${config.IPAYMU_VA}:${bodyHash}:${config.IPAYMU_API_KEY}`;
  return crypto.createHmac('sha256', config.IPAYMU_API_KEY!).update(stringToSign).digest('hex');
}

function ipaymuTimestamp(): string {
  // Format YmdHis, e.g. 20260710153000
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

async function ipaymuPost(path: string, body: Record<string, any>): Promise<any> {
  const jsonBody = JSON.stringify(body);
  const { data } = await axios.post(`${ipaymuBaseUrl()}${path}`, jsonBody, {
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      va: config.IPAYMU_VA!,
      signature: ipaymuSignature('POST', jsonBody),
      timestamp: ipaymuTimestamp(),
    },
    timeout: 15_000,
  });
  return data;
}

/**
 * Create an iPaymu hosted (redirect) payment.
 * referenceId = invoice.id so the notify callback can look it up.
 */
export async function createIpaymuPayment(
  invoice: InvoiceForPayment,
): Promise<{ sessionId: string; redirectUrl: string }> {
  const data = await ipaymuPost('/payment', {
    product: [`Blastify Plan ${invoice.plan} (1 bulan)`],
    qty: ['1'],
    price: [String(Math.round(invoice.amount / 100))], // iPaymu pakai IDR utuh
    returnUrl: `${config.FRONTEND_URL}/payment/success`,
    cancelUrl: `${config.FRONTEND_URL}/payment/cancelled`,
    notifyUrl: `${config.APP_URL}/api/v1/payments/ipaymu/notification`,
    referenceId: invoice.id,
    buyerName: invoice.user.name,
    buyerEmail: invoice.user.email,
    expired: 24,
    expiredType: 'hours',
  });

  if (data?.Status !== 200 || !data?.Data?.Url) {
    throw new Error(`iPaymu payment creation failed: ${data?.Message ?? 'unknown error'}`);
  }
  return { sessionId: data.Data.SessionID, redirectUrl: data.Data.Url };
}

/** Query transaction status directly from iPaymu (source of truth for callbacks). */
export async function checkIpaymuTransaction(transactionId: string): Promise<{
  isPaid: boolean;
  statusDesc: string;
  referenceId: string | null;
  via: string | null;
}> {
  const data = await ipaymuPost('/transaction', { transactionId });
  const d = data?.Data ?? {};
  const statusDesc = String(d.StatusDesc ?? d.Status ?? '').toLowerCase();
  return {
    isPaid: statusDesc === 'berhasil' || Number(d.Status) === 1,
    statusDesc,
    referenceId: d.ReferenceId ?? null,
    via: d.Via ?? d.PaymentChannel ?? null,
  };
}

/**
 * Handle iPaymu notify callback (form-urlencoded POST).
 * The callback carries no signature, so NEVER trust it directly —
 * always re-verify against the check-transaction API before settling.
 */
export async function handleIpaymuNotification(payload: any): Promise<{ status: string }> {
  const trxId = payload.trx_id ?? payload.transaction_id;
  const referenceId = payload.reference_id ?? payload.referenceId;

  if (!trxId || !referenceId) {
    const err = new Error('Missing trx_id or reference_id') as any;
    err.status = 400;
    err.code = 'INVALID_PAYLOAD';
    throw err;
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: String(referenceId) },
    include: { user: true },
  });
  if (!invoice) {
    const err = new Error('Invoice not found') as any;
    err.status = 404;
    err.code = 'INVOICE_NOT_FOUND';
    throw err;
  }

  // Source of truth: re-check status langsung ke iPaymu
  const trx = await checkIpaymuTransaction(String(trxId));

  if (trx.referenceId && trx.referenceId !== invoice.id) {
    logger.warn(`iPaymu trx ${trxId} referenceId mismatch: ${trx.referenceId} != ${invoice.id}`);
    const err = new Error('Reference mismatch') as any;
    err.status = 400;
    err.code = 'REFERENCE_MISMATCH';
    throw err;
  }

  if (trx.isPaid) {
    return settleInvoice(invoice, trx.via ? `ipaymu:${trx.via}` : 'ipaymu', 'invoice.paid_ipaymu');
  }

  if (['expired', 'gagal', 'dibatalkan'].includes(trx.statusDesc)) {
    if (invoice.status === 'PENDING') {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: trx.statusDesc === 'expired' ? 'EXPIRED' : 'CANCELLED' },
      });
    }
    return { status: trx.statusDesc };
  }

  return { status: `ignored:${trx.statusDesc}` };
}

// ─── Midtrans ─────────────────────────────────────────────────────────────────

function snapBaseUrl(): string {
  return config.MIDTRANS_IS_PRODUCTION
    ? 'https://app.midtrans.com/snap/v1'
    : 'https://app.sandbox.midtrans.com/snap/v1';
}

/**
 * Create a Midtrans Snap transaction for an invoice.
 * order_id = invoice.id so the notification callback can look it up directly.
 * Returns the Snap redirect URL (hosted payment page).
 */
export async function createSnapTransaction(invoice: {
  id: string;
  amount: number; // IDR dalam sen
  plan: string;
  user: { name: string; email: string };
}): Promise<{ token: string; redirectUrl: string }> {
  const auth = Buffer.from(`${config.MIDTRANS_SERVER_KEY}:`).toString('base64');

  const { data } = await axios.post(
    `${snapBaseUrl()}/transactions`,
    {
      transaction_details: {
        order_id: invoice.id,
        gross_amount: Math.round(invoice.amount / 100), // Midtrans pakai IDR utuh
      },
      item_details: [
        {
          id: `plan-${invoice.plan}`,
          price: Math.round(invoice.amount / 100),
          quantity: 1,
          name: `Blastify Plan ${invoice.plan} (1 bulan)`,
        },
      ],
      customer_details: {
        first_name: invoice.user.name,
        email: invoice.user.email,
      },
      expiry: { unit: 'hours', duration: 24 },
      callbacks: {
        finish: `${config.FRONTEND_URL}/payment/success`,
        error: `${config.FRONTEND_URL}/payment/cancelled`,
        pending: `${config.FRONTEND_URL}/payment/success`,
      },
    },
    {
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: 15_000,
    },
  );

  return { token: data.token, redirectUrl: data.redirect_url };
}

/**
 * Verify Midtrans notification signature:
 * sha512(order_id + status_code + gross_amount + server_key)
 */
export function verifyMidtransSignature(payload: {
  order_id: string;
  status_code: string;
  gross_amount: string;
  signature_key: string;
}): boolean {
  const expected = crypto
    .createHash('sha512')
    .update(
      `${payload.order_id}${payload.status_code}${payload.gross_amount}${config.MIDTRANS_SERVER_KEY}`,
    )
    .digest('hex');
  return expected === payload.signature_key;
}

/**
 * Handle Midtrans payment notification (webhook).
 * Idempotent: an already-PAID invoice is never processed twice.
 */
export async function handleMidtransNotification(payload: any): Promise<{ status: string }> {
  const {
    order_id: orderId,
    transaction_status: txStatus,
    fraud_status: fraudStatus,
    payment_type: paymentType,
  } = payload;

  if (!verifyMidtransSignature(payload)) {
    logger.warn(`Midtrans notification with invalid signature for order ${orderId}`);
    const err = new Error('Invalid signature') as any;
    err.status = 403;
    err.code = 'INVALID_SIGNATURE';
    throw err;
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: orderId },
    include: { user: true },
  });
  if (!invoice) {
    const err = new Error('Invoice not found') as any;
    err.status = 404;
    err.code = 'INVOICE_NOT_FOUND';
    throw err;
  }

  const isSettled =
    txStatus === 'settlement' ||
    (txStatus === 'capture' && (fraudStatus === 'accept' || !fraudStatus));

  if (isSettled) {
    return settleInvoice(invoice, paymentType ?? null, 'invoice.paid_midtrans');
  }

  if (['expire', 'cancel', 'deny', 'failure'].includes(txStatus)) {
    if (invoice.status === 'PENDING') {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: txStatus === 'expire' ? 'EXPIRED' : 'CANCELLED' },
      });
    }
    return { status: txStatus };
  }

  // pending / authorize / refund — no state change needed for now
  return { status: `ignored:${txStatus}` };
}
