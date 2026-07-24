import nodemailer, { Transporter } from 'nodemailer';
import { config } from '../config';
import { logger } from '../config/logger';
import { prisma } from '../prisma/client';
import { renderEmailTemplate } from './email-template.service';

const SUPPORT_EMAIL = 'support@blastify.id';

let transporter: Transporter | null = null;

export function isEmailEnabled(): boolean {
  return Boolean(config.SMTP_HOST);
}

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: config.SMTP_USER
        ? { user: config.SMTP_USER, pass: config.SMTP_PASS }
        : undefined,
    });
  }
  return transporter;
}

/**
 * Fire-and-forget email send. Never throws — email failure must not break
 * the main flow (register, payment, send message).
 */
export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!isEmailEnabled()) {
    logger.debug(`[EMAIL SKIPPED — SMTP not configured] to=${to} subject="${subject}"`);
    return;
  }
  try {
    await getTransporter().sendMail({ from: config.EMAIL_FROM, to, subject, html });
    logger.info(`Email sent to ${to}: ${subject}`);
  } catch (err: any) {
    logger.error(`Email send failed to ${to}: ${err.message}`);
  }
}

/**
 * Send an email rendered from a DB-backed template. Resolves the user's own
 * override for the slug first, falling back to the system default (userId
 * null). Never throws — matches sendEmail's fire-and-forget contract.
 *
 * `logoUrl` is injected into every render automatically so template authors
 * (admin defaults and user overrides alike) can just drop `{{logoUrl}}` into
 * an <img> tag without every caller having to pass it explicitly.
 */
export async function sendTemplateEmail(
  to: string,
  slug: string,
  variables: Record<string, any> = {},
  userId?: string,
): Promise<void> {
  const template = userId
    ? (await prisma.emailTemplate.findFirst({
        where: { userId, slug, isActive: true, deletedAt: null },
      })) ?? (await prisma.emailTemplate.findFirst({
        where: { userId: null, slug, isActive: true, deletedAt: null },
      }))
    : await prisma.emailTemplate.findFirst({
        where: { userId: null, slug, isActive: true, deletedAt: null },
      });

  if (!template) {
    logger.warn(`[EMAIL TEMPLATE MISSING] slug="${slug}" to=${to}`);
    return;
  }

  const ctx = { logoUrl: `${config.FRONTEND_URL}/logo.png`, ...variables };
  await sendEmail(to, renderEmailTemplate(template.subject, ctx), renderEmailTemplate(template.htmlContent, ctx));
}

// ─── Transactional emails ──────────────────────────────────────────────────────
// Thin wrappers around sendTemplateEmail — content lives in the DB (seeded from
// email-template-defaults.ts, editable per-user or by admin), these just supply
// the slug + variables for each triggered event.

export function sendWelcomeEmail(to: string, name: string, userId?: string): Promise<void> {
  return sendTemplateEmail(to, 'welcome', {
    name, email: to, appUrl: config.FRONTEND_URL, supportEmail: SUPPORT_EMAIL,
  }, userId);
}

export function sendVerificationEmail(to: string, name: string, token: string, userId?: string): Promise<void> {
  const verificationLink = `${config.APP_URL}/api/v1/auth/verify-email?token=${token}`;
  return sendTemplateEmail(to, 'registration-verification', {
    name, email: to, verificationLink, expiresIn: '24 jam',
  }, userId);
}

export function sendPasswordResetEmail(to: string, name: string, token: string, userId?: string): Promise<void> {
  const resetLink = `${config.FRONTEND_URL}/reset-password?token=${token}`;
  return sendTemplateEmail(to, 'password-reset', {
    name, resetLink, expiresIn: '1 jam', supportEmail: SUPPORT_EMAIL,
  }, userId);
}

export function sendPasswordChangedEmail(to: string, name: string, userId?: string): Promise<void> {
  return sendTemplateEmail(to, 'password-changed', {
    name, supportEmail: SUPPORT_EMAIL,
  }, userId);
}

export function sendQuotaWarningEmail(
  to: string,
  name: string,
  used: number,
  limit: number,
  plan: string,
  userId?: string,
): Promise<void> {
  const percentage = Math.round((used / limit) * 100);
  return sendTemplateEmail(to, 'quota-warning', {
    name, used: used.toLocaleString('id-ID'), limit: limit.toLocaleString('id-ID'), plan, percentage,
  }, userId);
}

export function sendInvoicePaidEmail(
  to: string,
  name: string,
  invoiceId: string,
  plan: string,
  amount: number,
  planExpiresAt: Date | null,
  userId?: string,
): Promise<void> {
  const rupiah = `Rp ${(amount / 100).toLocaleString('id-ID')}`;
  return sendTemplateEmail(to, 'payment-received', {
    name, invoiceId, amount: rupiah, transactionId: invoiceId,
    receiptLink: `${config.FRONTEND_URL}/account`,
    planName: plan,
    planExpiresAt: planExpiresAt
      ? planExpiresAt.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
      : '',
  }, userId);
}
