import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { errorResponse } from '../utils/response';

export interface AdminRequest extends Request {
  admin?: { adminId: string; role: string; email: string };
}

export function adminAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    errorResponse(res, 401, 'UNAUTHORIZED', 'Admin authentication required');
    return;
  }

  try {
    const payload = jwt.verify(token, config.ADMIN_JWT_SECRET) as {
      adminId: string;
      role: string;
      email: string;
    };
    (req as AdminRequest).admin = payload;
    next();
  } catch {
    errorResponse(res, 401, 'INVALID_TOKEN', 'Invalid or expired admin token');
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const admin = (req as AdminRequest).admin;
    if (!admin || !roles.includes(admin.role)) {
      errorResponse(res, 403, 'FORBIDDEN', `Required role: ${roles.join(' or ')}`);
      return;
    }
    next();
  };
}
