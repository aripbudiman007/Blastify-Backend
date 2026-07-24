import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { User } from '@prisma/client';
import { prisma } from '../prisma/client';
import { config } from '../config';
import { generateApiKey } from '../utils/crypto';
import { logger } from '../config/logger';
import { logAudit } from '../utils/audit';
import { JwtPayload } from '../types';

const SALT_ROUNDS = 12;

export async function registerUser(data: {
  name: string;
  email: string;
  password: string;
}): Promise<Omit<User, 'password'>> {
  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) {
    const err = new Error('Email already registered') as any;
    err.status = 409;
    err.code = 'EMAIL_TAKEN';
    throw err;
  }

  const hashed = await bcrypt.hash(data.password, SALT_ROUNDS);
  const apiKey = generateApiKey();

  const user = await prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      password: hashed,
      apiKey,
    },
    select: {
      id: true,
      email: true,
      name: true,
      plan: true,
      apiKey: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  // Audit logging — registration event
  logAudit({
    actorType: 'user',
    actorId: user.id,
    actorEmail: user.email,
    action: 'auth.registered',
  });

  // Fire-and-forget: welcome + verification email (never blocks registration)
  void issueVerificationEmail(user.id, user.email, user.name);
  void import('./email.service').then(({ sendWelcomeEmail }) =>
    sendWelcomeEmail(user.email, user.name, user.id),
  );

  return user as Omit<User, 'password'>;
}

async function issueVerificationEmail(userId: string, email: string, name: string): Promise<void> {
  try {
    await prisma.emailVerificationToken.deleteMany({ where: { userId } });

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await prisma.emailVerificationToken.create({ data: { userId, token, expiresAt } });

    const { sendVerificationEmail } = await import('./email.service');
    await sendVerificationEmail(email, name, token, userId);
  } catch (err: any) {
    logger.error(`Failed to issue verification email for ${email}: ${err.message}`);
  }
}

export async function verifyEmail(token: string): Promise<void> {
  const record = await prisma.emailVerificationToken.findUnique({ where: { token } });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    const err = new Error('Invalid or expired verification token') as any;
    err.status = 400; err.code = 'INVALID_VERIFICATION_TOKEN'; throw err;
  }

  const user = await prisma.user.findUnique({ where: { id: record.userId }, select: { email: true } });

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: new Date() },
    }),
    prisma.emailVerificationToken.update({
      where: { token },
      data: { usedAt: new Date() },
    }),
  ]);

  // Audit logging — email verified
  logAudit({
    actorType: 'user',
    actorId: record.userId,
    actorEmail: user?.email || 'unknown',
    action: 'auth.email_verified',
  });
}

export async function resendVerification(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  // Silent no-op untuk email yang tidak terdaftar / sudah terverifikasi (anti-enumeration)
  if (!user || user.emailVerifiedAt) return;
  await issueVerificationEmail(user.id, user.email, user.name);
}

function signAccessToken(user: User): string {
  const payload: JwtPayload = { sub: user.id, email: user.email };
  return jwt.sign(payload, config.JWT_SECRET, { expiresIn: config.JWT_EXPIRES_IN as any });
}

function signRefreshToken(user: User): string {
  const payload: JwtPayload = { sub: user.id, email: user.email };
  return jwt.sign(payload, config.JWT_REFRESH_SECRET, {
    expiresIn: config.JWT_REFRESH_EXPIRES_IN as any,
  });
}

export async function loginUser(
  email: string,
  password: string,
  otp?: string,
): Promise<{
  accessToken: string;
  refreshToken: string;
  user: Omit<User, 'password' | 'totpSecret'> & { totpEnabled: boolean };
}> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    const err = new Error('Invalid credentials') as any;
    err.status = 401;
    throw err;
  }

  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    const err = new Error('Invalid credentials') as any;
    err.status = 401;
    throw err;
  }

  if (config.EMAIL_VERIFICATION_REQUIRED && !user.emailVerifiedAt) {
    const err = new Error('Email not verified. Check your inbox for the verification link.') as any;
    err.status = 403;
    err.code = 'EMAIL_NOT_VERIFIED';
    throw err;
  }

  // 2FA — password valid, tapi butuh kode TOTP dari authenticator app
  if (user.totpEnabledAt && user.totpSecret) {
    if (!otp) {
      const err = new Error('Two-factor code required. Re-submit login with the "otp" field.') as any;
      err.status = 403;
      err.code = 'OTP_REQUIRED';
      throw err;
    }
    const { verifyTotp } = await import('../utils/totp');
    if (!verifyTotp(user.totpSecret, otp)) {
      const err = new Error('Invalid two-factor code') as any;
      err.status = 401;
      err.code = 'INVALID_OTP';
      throw err;
    }
  }

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  await prisma.refreshToken.create({
    data: { userId: user.id, token: refreshToken, expiresAt },
  });

  // Audit logging — successful login event
  logAudit({
    actorType: 'user',
    actorId: user.id,
    actorEmail: user.email,
    action: 'auth.login',
  });

  const { password: _pw, totpSecret: _ts, ...safeUser } = user;
  return { accessToken, refreshToken, user: { ...safeUser, totpEnabled: Boolean(user.totpEnabledAt) } };
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string }> {
  let payload: JwtPayload;
  try {
    payload = jwt.verify(refreshToken, config.JWT_REFRESH_SECRET) as JwtPayload;
  } catch {
    const err = new Error('Invalid or expired refresh token') as any;
    err.status = 401;
    throw err;
  }

  const stored = await prisma.refreshToken.findUnique({ where: { token: refreshToken } });
  if (!stored || stored.expiresAt < new Date()) {
    const err = new Error('Refresh token revoked or expired') as any;
    err.status = 401;
    throw err;
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) {
    const err = new Error('User not found') as any;
    err.status = 401;
    throw err;
  }

  const accessToken = signAccessToken(user);
  return { accessToken };
}

export async function logoutUser(refreshToken: string): Promise<void> {
  await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
}

export async function forgotPassword(email: string): Promise<{ token: string; email: string }> {
  const user = await prisma.user.findUnique({ where: { email } });
  // Always return success to prevent email enumeration
  if (!user) return { token: '', email };

  // Invalidate previous tokens
  await (prisma as any).passwordResetToken.deleteMany({ where: { userId: user.id } });

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await (prisma as any).passwordResetToken.create({
    data: { userId: user.id, token, expiresAt },
  });

  const { sendPasswordResetEmail } = await import('./email.service');
  await sendPasswordResetEmail(email, user.name, token, user.id);
  logger.info(`[PASSWORD RESET] link sent to ${email}`);
  return { token, email };
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const record = await (prisma as any).passwordResetToken.findUnique({ where: { token } });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    const err = new Error('Invalid or expired reset token') as any;
    err.status = 400; err.code = 'INVALID_RESET_TOKEN'; throw err;
  }

  const hashed = await bcrypt.hash(newPassword, 12);
  const [user] = await Promise.all([
    prisma.user.update({ where: { id: record.userId }, data: { password: hashed } }),
    (prisma as any).passwordResetToken.update({
      where: { token },
      data: { usedAt: new Date() },
    }),
    // Revoke all refresh tokens
    prisma.refreshToken.deleteMany({ where: { userId: record.userId } }),
  ]);

  // Audit logging — password reset
  logAudit({
    actorType: 'user',
    actorId: user.id,
    actorEmail: user.email,
    action: 'auth.password_reset',
  });

  const { sendPasswordChangedEmail } = await import('./email.service');
  void sendPasswordChangedEmail(user.email, user.name, user.id);
}
