import { Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { AuthenticatedRequest } from '../types';
import { successResponse, errorResponse } from '../utils/response';
import { prisma } from '../prisma/client';
import { generateApiKey } from '../utils/crypto';
import { logAudit } from '../utils/audit';

export async function getMe(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.user!;

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [messagesSentThisMonth, totalDevices, connectedDevices] = await Promise.all([
      prisma.message.count({
        where: { userId: user.id, createdAt: { gte: startOfMonth }, status: { in: ['SENT', 'DELIVERED', 'READ'] } },
      }),
      prisma.device.count({ where: { userId: user.id } }),
      prisma.device.count({ where: { userId: user.id, status: 'CONNECTED' } }),
    ]);

    successResponse(res, {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        plan: user.plan,
        isActive: user.isActive,
        emailVerified: Boolean(user.emailVerifiedAt),
        totpEnabled: Boolean(user.totpEnabledAt),
        planExpiresAt: user.planExpiresAt,
        createdAt: user.createdAt,
      },
      usage: {
        messagesSentThisMonth,
        totalDevices,
        connectedDevices,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function updateMe(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.user!;
    const { name, password } = req.body;

    const updateData: any = {};
    if (name) updateData.name = name;
    if (password) {
      updateData.password = await bcrypt.hash(password, 12);
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: updateData,
      select: { id: true, name: true, email: true, plan: true, updatedAt: true },
    });

    // Audit logging — password changed
    if (password) {
      logAudit({
        actorType: 'user',
        actorId: user.id,
        actorEmail: user.email,
        action: 'account.password_changed',
      });
    }

    successResponse(res, { user: updated });
  } catch (err) {
    next(err);
  }
}

export async function getApiKey(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const masked = `${req.user!.apiKey.slice(0, 8)}${'*'.repeat(req.user!.apiKey.length - 12)}${req.user!.apiKey.slice(-4)}`;
    successResponse(res, { apiKey: masked });
  } catch (err) {
    next(err);
  }
}

export async function getStats(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.id;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    const [
      totalMessages,
      messagesThisMonth,
      messagesLastMonth,
      messagesByStatus,
      totalDevices,
      devicesByStatus,
      totalWebhooks,
    ] = await Promise.all([
      prisma.message.count({ where: { userId } }),
      prisma.message.count({ where: { userId, createdAt: { gte: startOfMonth } } }),
      prisma.message.count({ where: { userId, createdAt: { gte: startOfLastMonth, lte: endOfLastMonth } } }),
      prisma.message.groupBy({
        by: ['status'],
        where: { userId },
        _count: { status: true },
      }),
      prisma.device.count({ where: { userId } }),
      prisma.device.groupBy({
        by: ['status'],
        where: { userId },
        _count: { status: true },
      }),
      prisma.webhook.count({ where: { userId, isActive: true } }),
    ]);

    const statusBreakdown = Object.fromEntries(
      messagesByStatus.map((r) => [r.status.toLowerCase(), r._count.status]),
    );
    const deviceBreakdown = Object.fromEntries(
      devicesByStatus.map((r) => [r.status.toLowerCase(), r._count.status]),
    );

    successResponse(res, {
      messages: {
        total: totalMessages,
        thisMonth: messagesThisMonth,
        lastMonth: messagesLastMonth,
        byStatus: statusBreakdown,
      },
      devices: {
        total: totalDevices,
        byStatus: deviceBreakdown,
      },
      webhooks: {
        activeTotal: totalWebhooks,
      },
    });
  } catch (err) {
    next(err);
  }
}

// Harga plan dibaca dari tabel PlanLimit (kolom price) via getPlanPrice —
// bisa diubah admin lewat PUT /admin/plans/:plan tanpa deploy

// ─── 2FA (TOTP) ───────────────────────────────────────────────────────────────

export async function setup2fa(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { generateTotpSecret, otpauthUri } = await import('../utils/totp');
    const QRCode = (await import('qrcode')).default;

    if (req.user!.totpEnabledAt) {
      errorResponse(res, 400, '2FA_ALREADY_ENABLED', 'Disable 2FA first before generating a new secret');
      return;
    }

    const secret = generateTotpSecret();
    await prisma.user.update({ where: { id: req.user!.id }, data: { totpSecret: secret } });

    const uri = otpauthUri(secret, req.user!.email);
    const qrDataUrl = await QRCode.toDataURL(uri);

    successResponse(res, {
      secret,
      otpauthUri: uri,
      qrDataUrl,
      message: 'Scan the QR with Google Authenticator/Authy, then call POST /account/2fa/enable with a code.',
    });
  } catch (err) { next(err); }
}

export async function enable2fa(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { verifyTotp } = await import('../utils/totp');
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });

    if (!user?.totpSecret) {
      errorResponse(res, 400, '2FA_NOT_SETUP', 'Call POST /account/2fa/setup first');
      return;
    }
    if (user.totpEnabledAt) {
      errorResponse(res, 400, '2FA_ALREADY_ENABLED', '2FA is already enabled');
      return;
    }
    if (!verifyTotp(user.totpSecret, req.body.otp)) {
      errorResponse(res, 401, 'INVALID_OTP', 'Invalid two-factor code');
      return;
    }

    await prisma.user.update({ where: { id: user.id }, data: { totpEnabledAt: new Date() } });

    logAudit({
      actorType: 'user',
      actorId: user.id,
      actorEmail: user.email,
      action: 'account.2fa_enabled',
    });

    successResponse(res, { message: '2FA enabled. Login now requires an authenticator code.' });
  } catch (err) { next(err); }
}

export async function disable2fa(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const bcrypt = (await import('bcryptjs')).default;
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });

    if (!user?.totpEnabledAt) {
      errorResponse(res, 400, '2FA_NOT_ENABLED', '2FA is not enabled');
      return;
    }
    // Verifikasi password (bukan OTP) supaya user yang kehilangan authenticator tetap bisa lepas 2FA
    const match = await bcrypt.compare(req.body.password, user.password);
    if (!match) {
      errorResponse(res, 401, 'INVALID_PASSWORD', 'Wrong password');
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { totpSecret: null, totpEnabledAt: null },
    });

    logAudit({
      actorType: 'user',
      actorId: user.id,
      actorEmail: user.email,
      action: 'account.2fa_disabled',
    });

    successResponse(res, { message: '2FA disabled' });
  } catch (err) { next(err); }
}

export async function getAiUsage(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { getAiUsage: getUsage, currentAiMonth } = await import('../services/ai.service');
    const { getPlanLimits } = await import('../middleware/plan.middleware');

    const [used, limits] = await Promise.all([
      getUsage(req.user!.id),
      getPlanLimits(req.user!.plan),
    ]);
    const limit = (limits as any).aiMonthlyReplies ?? 0;

    successResponse(res, {
      month: currentAiMonth(),
      used,
      limit, // 0 = plan tanpa AI, -1 = unlimited
      remaining: limit === -1 ? -1 : Math.max(0, limit - used),
      plan: req.user!.plan,
    });
  } catch (err) {
    next(err);
  }
}

export async function getInvoices(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const invoices = await (prisma as any).invoice.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    successResponse(res, { invoices });
  } catch (err) {
    next(err);
  }
}

export async function upgradePlan(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { plan } = req.body as { plan: string };
    const validPlans = ['FREE', 'LITE', 'REGULAR', 'MASTER', 'ULTRA'];

    if (!validPlans.includes(plan)) {
      errorResponse(res, 400, 'INVALID_PLAN', `Valid plans: ${validPlans.join(', ')}`);
      return;
    }

    const { getPlanPrice } = await import('../middleware/plan.middleware');
    const amount = await getPlanPrice(plan as any);

    const invoice = await (prisma as any).invoice.create({
      data: {
        userId: req.user!.id,
        plan,
        amount,
        status: amount === 0 ? 'PAID' : 'PENDING',
        paidAt: amount === 0 ? new Date() : null,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
        notes: `Upgrade to ${plan}`,
      },
    });

    // Free plan — apply immediately
    if (amount === 0) {
      await prisma.user.update({ where: { id: req.user!.id }, data: { plan: plan as any } });
      successResponse(res, { invoice, message: `Plan upgraded to ${plan}` });
      return;
    }

    // Paid plan — create hosted payment on the active gateway (iPaymu/Midtrans),
    // otherwise fall back to manual payment flow (admin confirms invoice)
    const { isPaymentGatewayEnabled, createPaymentTransaction } = await import('../services/payment.service');

    let paymentUrl: string;
    let snapToken: string | undefined;

    if (isPaymentGatewayEnabled()) {
      const trx = await createPaymentTransaction({
        id: invoice.id,
        amount,
        plan,
        user: { name: req.user!.name, email: req.user!.email },
      });
      paymentUrl = trx.redirectUrl;
      snapToken = trx.token;
    } else {
      paymentUrl = `${process.env.APP_URL}/pay/${invoice.id}`;
    }

    await (prisma as any).invoice.update({
      where: { id: invoice.id },
      data: { paymentUrl },
    });

    successResponse(res, {
      invoice: { ...invoice, paymentUrl },
      ...(snapToken ? { snapToken } : {}),
      message: 'Invoice created. Complete payment to activate plan.',
    });
  } catch (err) {
    next(err);
  }
}

export async function regenerateApiKey(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const newApiKey = generateApiKey();

    await prisma.user.update({
      where: { id: req.user!.id },
      data: { apiKey: newApiKey },
    });

    logAudit({
      actorType: 'user',
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'account.api_key_regenerated',
    });

    successResponse(res, {
      apiKey: newApiKey,
      message: 'API key regenerated. Save this — it will not be shown again.',
    });
  } catch (err) {
    next(err);
  }
}
