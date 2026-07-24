import { prisma } from '../prisma/client';
import { getSession } from '../baileys/session';

/** Round-robin pointer per user stored in memory (resets on restart — acceptable) */
const rotationPointers = new Map<string, number>();

/**
 * Returns the ID of the next connected device for a user using round-robin.
 * Skips devices that have no active Baileys session.
 */
export async function getNextDevice(userId: string): Promise<string | null> {
  const devices = await prisma.device.findMany({
    where: { userId, status: 'CONNECTED' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  if (devices.length === 0) return null;

  // Filter to only truly active sessions
  const active = devices.filter((d) => !!getSession(d.id));
  if (active.length === 0) return null;

  const ptr = rotationPointers.get(userId) ?? 0;
  const idx = ptr % active.length;
  rotationPointers.set(userId, idx + 1);

  return active[idx].id;
}
