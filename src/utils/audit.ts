import { prisma } from '../prisma/client';

export interface AuditParams {
  actorType: 'user' | 'admin';
  actorId: string;
  actorEmail: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
}

/**
 * Fire-and-forget audit log. Never awaited in production handlers.
 * Errors are silently discarded to avoid breaking the main flow.
 */
export function logAudit(params: AuditParams): void {
  prisma.auditLog.create({
    data: {
      ...params,
      metadata: params.metadata ? (params.metadata as any) : undefined,
    },
  }).catch(() => {});
}
