import { Response } from 'express';
import { ApiError, PaginationMeta } from '../types';

export function successResponse<T>(
  res: Response,
  data: T,
  statusCode = 200,
  meta?: PaginationMeta,
): Response {
  return res.status(statusCode).json({
    success: true,
    data,
    ...(meta ? { meta } : {}),
  });
}

export function errorResponse(
  res: Response,
  statusCode: number,
  code: string,
  message: string,
  details?: any,
): Response {
  const error: ApiError = { code, message };
  if (details !== undefined) error.details = details;

  return res.status(statusCode).json({
    success: false,
    error,
  });
}

export function paginationMeta(page: number, limit: number, total: number): PaginationMeta {
  return { page, limit, total };
}

export function parsePagination(query: { page?: string; limit?: string }): {
  page: number;
  limit: number;
  skip: number;
} {
  const page = Math.max(1, parseInt(query.page ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '20', 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
}
