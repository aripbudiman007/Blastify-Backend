import { Request, Response, NextFunction } from 'express';
import {
  registerUser,
  loginUser,
  refreshAccessToken,
  logoutUser,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification,
} from '../services/auth.service';
import { successResponse, errorResponse } from '../utils/response';

export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await registerUser(req.body);
    successResponse(res, { user }, 201);
  } catch (err: any) {
    if (err.code === 'EMAIL_TAKEN') {
      errorResponse(res, 409, 'EMAIL_TAKEN', err.message);
      return;
    }
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await loginUser(req.body.email, req.body.password, req.body.otp);
    successResponse(res, result);
  } catch (err: any) {
    if (err.code === 'EMAIL_NOT_VERIFIED' || err.code === 'OTP_REQUIRED') {
      errorResponse(res, 403, err.code, err.message);
      return;
    }
    if (err.code === 'INVALID_OTP') {
      errorResponse(res, 401, 'INVALID_OTP', err.message);
      return;
    }
    if (err.status === 401) {
      errorResponse(res, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');
      return;
    }
    next(err);
  }
}

export async function verify(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await verifyEmail(req.query.token as string);
    successResponse(res, { message: 'Email verified successfully. You can now login.' });
  } catch (err: any) {
    if (err.code === 'INVALID_VERIFICATION_TOKEN') {
      errorResponse(res, 400, 'INVALID_VERIFICATION_TOKEN', err.message);
      return;
    }
    next(err);
  }
}

export async function resendVerify(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await resendVerification(req.body.email);
    // Always 200 to prevent email enumeration
    successResponse(res, { message: 'If that email is registered and unverified, a new link has been sent.' });
  } catch (err) {
    next(err);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await refreshAccessToken(req.body.refreshToken);
    successResponse(res, result);
  } catch (err: any) {
    if (err.status === 401) {
      errorResponse(res, 401, 'INVALID_REFRESH_TOKEN', err.message);
      return;
    }
    next(err);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await logoutUser(req.body.refreshToken);
    successResponse(res, { message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
}

export async function forgot(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await forgotPassword(req.body.email);
    // Always 200 to prevent email enumeration
    successResponse(res, {
      message: 'If that email exists, a reset link has been sent.',
      // In dev mode expose token; remove in production
      ...(process.env.NODE_ENV !== 'production' && result.token ? { devToken: result.token } : {}),
    });
  } catch (err) {
    next(err);
  }
}

export async function reset(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await resetPassword(req.body.token, req.body.password);
    successResponse(res, { message: 'Password reset successful. Please login again.' });
  } catch (err: any) {
    if (err.code === 'INVALID_RESET_TOKEN') {
      errorResponse(res, 400, 'INVALID_RESET_TOKEN', err.message);
      return;
    }
    next(err);
  }
}
