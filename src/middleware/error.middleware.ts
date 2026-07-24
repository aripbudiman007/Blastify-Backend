import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { logger } from '../config/logger';
import { captureException } from '../config/sentry';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    },
  });
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  logger.error(`${req.method} ${req.path} — ${err.message}`, {
    stack: err.stack,
  });

  if (err instanceof ZodError) {
    res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.flatten().fieldErrors,
      },
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({
        success: false,
        error: {
          code: 'DUPLICATE_ENTRY',
          message: 'A record with this value already exists',
          details: { fields: err.meta?.target },
        },
      });
      return;
    }

    if (err.code === 'P2025') {
      res.status(404).json({
        success: false,
        error: {
          code: 'RECORD_NOT_FOUND',
          message: 'The requested record was not found',
        },
      });
      return;
    }
  }

  const status = (err as any).status ?? (err as any).statusCode ?? 500;
  const errCode = (err as any).code;
  const isClientError = status >= 400 && status < 500;

  if (!isClientError) {
    captureException(err, { method: req.method, path: req.path });
  }

  res.status(status).json({
    success: false,
    error: {
      // Error 4xx dengan kode string custom (mis. MESSAGE_TYPE_NOT_ALLOWED) diteruskan apa adanya
      code: isClientError && typeof errCode === 'string' ? errCode : 'INTERNAL_ERROR',
      message:
        !isClientError && process.env.NODE_ENV === 'production'
          ? 'An internal error occurred'
          : err.message,
      ...((err as any).details !== undefined ? { details: (err as any).details } : {}),
    },
  });
}
