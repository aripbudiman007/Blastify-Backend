import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma/client';
import { config } from '../config';
import { errorResponse } from '../utils/response';
import { AuthenticatedRequest, JwtPayload } from '../types';
import { checkIpAllowed } from '../services/ipwhitelist.service';

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    const apiKeyHeader = req.headers['x-api-key'] as string | undefined;
    const apiKeyQuery = req.query.apiKey as string | undefined;

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);

      let payload: JwtPayload;
      try {
        payload = jwt.verify(token, config.JWT_SECRET) as JwtPayload;
      } catch {
        errorResponse(res, 401, 'INVALID_TOKEN', 'Invalid or expired access token');
        return;
      }

      const user = await prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user || !user.isActive) {
        errorResponse(res, 401, 'USER_NOT_FOUND', 'User not found or inactive');
        return;
      }

      (req as AuthenticatedRequest).user = user;
      next();
      return;
    }

    const apiKey = apiKeyHeader ?? apiKeyQuery;
    if (apiKey) {
      const user = await prisma.user.findUnique({ where: { apiKey } });
      if (!user || !user.isActive) {
        errorResponse(res, 401, 'INVALID_API_KEY', 'Invalid API key');
        return;
      }

      // IP Whitelist check — only for REGULAR+ plans and only for API Key auth
      const ipWhitelistPlans = ['REGULAR', 'MASTER', 'ULTRA'];
      if (ipWhitelistPlans.includes(user.plan)) {
        const clientIp = req.ip ?? req.socket.remoteAddress ?? '';
        const allowed = await checkIpAllowed(user.id, clientIp);
        if (!allowed) {
          errorResponse(res, 403, 'IP_NOT_ALLOWED', 'IP address not in whitelist');
          return;
        }
      }

      (req as AuthenticatedRequest).user = user;
      next();
      return;
    }

    errorResponse(res, 401, 'UNAUTHORIZED', 'Authentication required');
  } catch (err) {
    next(err);
  }
}
