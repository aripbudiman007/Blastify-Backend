import { prisma } from '../prisma/client';

/**
 * Simple CIDR / exact-IP matcher.
 * Supports IPv4 exact ("1.2.3.4") and IPv4 CIDR ("1.2.3.0/24").
 * IPv6 is treated as exact-match only.
 */
export function ipMatchesCidr(clientIp: string, cidr: string): boolean {
  // Strip IPv6-mapped IPv4 prefix (::ffff:)
  const ip = clientIp.replace(/^::ffff:/, '');

  if (!cidr.includes('/')) {
    return ip === cidr;
  }

  const [range, bitsStr] = cidr.split('/');
  const bits = parseInt(bitsStr, 10);

  const ipToNum = (addr: string): number => {
    const parts = addr.split('.').map(Number);
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  };

  try {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipToNum(ip) & mask) === (ipToNum(range) & mask);
  } catch {
    return ip === range;
  }
}

export async function listWhitelists(userId: string) {
  return prisma.ipWhitelist.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function addWhitelist(userId: string, ip: string, label?: string) {
  try {
    return await prisma.ipWhitelist.create({ data: { userId, ip, label } });
  } catch (err: any) {
    if (err.code === 'P2002') {
      const e = new Error('IP already whitelisted') as any;
      e.status = 409; e.code = 'IP_DUPLICATE'; throw e;
    }
    throw err;
  }
}

export async function updateWhitelist(
  userId: string,
  id: string,
  data: { label?: string; isActive?: boolean; ip?: string },
) {
  const entry = await prisma.ipWhitelist.findFirst({ where: { id, userId } });
  if (!entry) {
    const err = new Error('Whitelist entry not found') as any;
    err.status = 404; err.code = 'NOT_FOUND'; throw err;
  }
  return prisma.ipWhitelist.update({ where: { id }, data });
}

export async function deleteWhitelist(userId: string, id: string) {
  const entry = await prisma.ipWhitelist.findFirst({ where: { id, userId } });
  if (!entry) {
    const err = new Error('Whitelist entry not found') as any;
    err.status = 404; err.code = 'NOT_FOUND'; throw err;
  }
  await prisma.ipWhitelist.delete({ where: { id } });
}

/** Check whether a clientIp is allowed for this user (only when whitelist is non-empty) */
export async function checkIpAllowed(userId: string, clientIp: string): Promise<boolean> {
  const whitelists = await prisma.ipWhitelist.findMany({
    where: { userId, isActive: true },
  });
  if (whitelists.length === 0) return true; // no restriction
  return whitelists.some((w) => ipMatchesCidr(clientIp, w.ip));
}
