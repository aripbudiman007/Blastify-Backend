import { prisma } from '../prisma/client';
import { createSession, deleteSession, getSession } from '../baileys/session';
import { DeviceStatus, DeviceAgentRole } from '@prisma/client';
import { checkDeviceLimit } from '../middleware/plan.middleware';
import { formatPhone } from '../utils/jid';
import { getWarmupStage } from '../utils/warmup';

export async function listDevices(userId: string) {
  return prisma.device.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      phone: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createDevice(userId: string, name: string, plan: any) {
  await checkDeviceLimit(userId, plan);
  return prisma.device.create({
    data: { userId, name },
    select: {
      id: true,
      name: true,
      phone: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function getDevice(userId: string, deviceId: string) {
  const device = await prisma.device.findFirst({
    where: { id: deviceId, userId },
    select: {
      id: true,
      name: true,
      phone: true,
      status: true,
      qrCode: true,
      webhookId: true,
      warmupEnabled: true,
      warmupStartedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!device) {
    const err = new Error('Device not found') as any;
    err.status = 404;
    err.code = 'DEVICE_NOT_FOUND';
    throw err;
  }

  const { warmupStartedAt, ...rest } = device;
  return {
    ...rest,
    warmup: device.warmupEnabled
      ? { startedAt: warmupStartedAt, ...(warmupStartedAt ? getWarmupStage(warmupStartedAt) : null) }
      : null,
  };
}

export async function removeDevice(userId: string, deviceId: string): Promise<void> {
  const device = await prisma.device.findFirst({ where: { id: deviceId, userId } });
  if (!device) {
    const err = new Error('Device not found') as any;
    err.status = 404;
    err.code = 'DEVICE_NOT_FOUND';
    throw err;
  }

  await deleteSession(deviceId);
  await prisma.device.delete({ where: { id: deviceId } });
}

export async function connectDevice(userId: string, deviceId: string) {
  const device = await prisma.device.findFirst({ where: { id: deviceId, userId } });
  if (!device) {
    const err = new Error('Device not found') as any;
    err.status = 404;
    err.code = 'DEVICE_NOT_FOUND';
    throw err;
  }

  // createSession runs async — QR_READY status arrives via Socket.IO event or GET /qr polling
  createSession(deviceId).catch(() => null);
  return {
    deviceId,
    status: 'CONNECTING',
    message: 'Connection initiated. Scan QR via Socket.IO event "qr" or poll GET /devices/:id/qr',
  };
}

export async function disconnectDevice(userId: string, deviceId: string) {
  const device = await prisma.device.findFirst({ where: { id: deviceId, userId } });
  if (!device) {
    const err = new Error('Device not found') as any;
    err.status = 404;
    err.code = 'DEVICE_NOT_FOUND';
    throw err;
  }

  const sock = getSession(deviceId);
  if (sock) {
    try {
      await sock.logout();
    } catch {
      sock.end(undefined);
    }
  }

  await prisma.device.update({
    where: { id: deviceId },
    data: { status: DeviceStatus.DISCONNECTED, qrCode: null },
  });

  return { message: 'Device disconnected' };
}

export async function getDeviceQR(userId: string, deviceId: string) {
  const device = await prisma.device.findFirst({
    where: { id: deviceId, userId },
    select: { status: true, qrCode: true },
  });

  if (!device) {
    const err = new Error('Device not found') as any;
    err.status = 404;
    err.code = 'DEVICE_NOT_FOUND';
    throw err;
  }

  if (device.status !== DeviceStatus.QR_READY || !device.qrCode) {
    const err = new Error('No QR code available. Start connection first.') as any;
    err.status = 400;
    err.code = 'QR_NOT_READY';
    throw err;
  }

  return { qrCode: device.qrCode, status: device.status };
}

// ─── Device Settings (delay, working hours, bad words) ────────────────────────

export interface DeviceSettingsInput {
  name?: string;
  minDelay?: number;
  maxDelay?: number;
  workingHoursStart?: number | null;
  workingHoursEnd?: number | null;
  workingDays?: number[];
  badWordsEnabled?: boolean;
  badWords?: string[];
  autoSaveContacts?: boolean;
  typingIndicator?: boolean;
  readReceiptSimulation?: boolean;
  warmupEnabled?: boolean;
}

export async function updateDeviceSettings(
  userId: string,
  deviceId: string,
  settings: DeviceSettingsInput,
) {
  const device = await prisma.device.findFirst({ where: { id: deviceId, userId } });
  if (!device) {
    const err = new Error('Device not found') as any;
    err.status = 404; err.code = 'DEVICE_NOT_FOUND'; throw err;
  }

  if (settings.minDelay != null && settings.maxDelay != null) {
    if (settings.minDelay > settings.maxDelay) {
      const err = new Error('minDelay cannot be greater than maxDelay') as any;
      err.status = 400; err.code = 'INVALID_DELAY'; throw err;
    }
  }

  // Enabling warm-up on a device that's already connected right now starts
  // the clock immediately — otherwise it starts on the next `connection=open`
  // event (see session.ts). Once started, the clock is never reset here.
  const startWarmupNow =
    settings.warmupEnabled === true &&
    !device.warmupEnabled &&
    !device.warmupStartedAt &&
    device.status === 'CONNECTED';

  return prisma.device.update({
    where: { id: deviceId },
    data: {
      ...(settings.name != null ? { name: settings.name } : {}),
      ...(settings.minDelay != null ? { minDelay: settings.minDelay } : {}),
      ...(settings.maxDelay != null ? { maxDelay: settings.maxDelay } : {}),
      ...(settings.workingHoursStart !== undefined ? { workingHoursStart: settings.workingHoursStart } : {}),
      ...(settings.workingHoursEnd !== undefined ? { workingHoursEnd: settings.workingHoursEnd } : {}),
      ...(settings.workingDays != null ? { workingDays: settings.workingDays } : {}),
      ...(settings.badWordsEnabled != null ? { badWordsEnabled: settings.badWordsEnabled } : {}),
      ...(settings.badWords != null ? { badWords: settings.badWords } : {}),
      ...(settings.autoSaveContacts != null ? { autoSaveContacts: settings.autoSaveContacts } : {}),
      ...(settings.typingIndicator != null ? { typingIndicator: settings.typingIndicator } : {}),
      ...(settings.readReceiptSimulation != null ? { readReceiptSimulation: settings.readReceiptSimulation } : {}),
      ...(settings.warmupEnabled != null ? { warmupEnabled: settings.warmupEnabled } : {}),
      ...(startWarmupNow ? { warmupStartedAt: new Date() } : {}),
    },
    select: {
      id: true, name: true, status: true, phone: true,
      minDelay: true, maxDelay: true,
      workingHoursStart: true, workingHoursEnd: true, workingDays: true,
      badWordsEnabled: true, badWords: true,
      autoSaveContacts: true,
      typingIndicator: true, readReceiptSimulation: true,
      warmupEnabled: true, warmupStartedAt: true,
      updatedAt: true,
    },
  });
}

// ─── Device Agents (Multi-agent) ─────────────────────────────────────────────

export async function listDeviceAgents(userId: string, deviceId: string) {
  // Only device owner can list agents
  const device = await prisma.device.findFirst({ where: { id: deviceId, userId } });
  if (!device) {
    const err = new Error('Device not found') as any;
    err.status = 404; err.code = 'DEVICE_NOT_FOUND'; throw err;
  }

  return prisma.deviceAgent.findMany({
    where: { deviceId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'asc' },
  });
}

export async function addDeviceAgent(
  ownerId: string,
  deviceId: string,
  agentEmail: string,
  role: DeviceAgentRole = DeviceAgentRole.AGENT,
) {
  const device = await prisma.device.findFirst({ where: { id: deviceId, userId: ownerId } });
  if (!device) {
    const err = new Error('Device not found') as any;
    err.status = 404; err.code = 'DEVICE_NOT_FOUND'; throw err;
  }

  const agentUser = await prisma.user.findUnique({ where: { email: agentEmail } });
  if (!agentUser) {
    const err = new Error(`No user found with email "${agentEmail}"`) as any;
    err.status = 404; err.code = 'USER_NOT_FOUND'; throw err;
  }

  if (agentUser.id === ownerId) {
    const err = new Error('Cannot add yourself as an agent') as any;
    err.status = 400; err.code = 'CANNOT_ADD_SELF'; throw err;
  }

  const existing = await prisma.deviceAgent.findUnique({
    where: { deviceId_userId: { deviceId, userId: agentUser.id } },
  });
  if (existing) {
    const err = new Error('This user is already an agent for this device') as any;
    err.status = 409; err.code = 'AGENT_ALREADY_EXISTS'; throw err;
  }

  return prisma.deviceAgent.create({
    data: { deviceId, userId: agentUser.id, role, invitedBy: ownerId },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
}

export async function updateDeviceAgent(
  ownerId: string,
  deviceId: string,
  agentId: string,
  role: DeviceAgentRole,
) {
  const device = await prisma.device.findFirst({ where: { id: deviceId, userId: ownerId } });
  if (!device) {
    const err = new Error('Device not found') as any;
    err.status = 404; err.code = 'DEVICE_NOT_FOUND'; throw err;
  }

  const agent = await prisma.deviceAgent.findUnique({ where: { id: agentId } });
  if (!agent || agent.deviceId !== deviceId) {
    const err = new Error('Agent not found') as any;
    err.status = 404; err.code = 'AGENT_NOT_FOUND'; throw err;
  }

  return prisma.deviceAgent.update({
    where: { id: agentId },
    data: { role },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
}

export async function removeDeviceAgent(
  ownerId: string,
  deviceId: string,
  agentId: string,
) {
  const device = await prisma.device.findFirst({ where: { id: deviceId, userId: ownerId } });
  if (!device) {
    const err = new Error('Device not found') as any;
    err.status = 404; err.code = 'DEVICE_NOT_FOUND'; throw err;
  }

  const agent = await prisma.deviceAgent.findUnique({ where: { id: agentId } });
  if (!agent || agent.deviceId !== deviceId) {
    const err = new Error('Agent not found') as any;
    err.status = 404; err.code = 'AGENT_NOT_FOUND'; throw err;
  }

  await prisma.deviceAgent.delete({ where: { id: agentId } });
}

/** Check if a userId has access to a deviceId (owner OR active agent) */
export async function hasDeviceAccess(userId: string, deviceId: string): Promise<boolean> {
  const device = await prisma.device.findFirst({ where: { id: deviceId, userId } });
  if (device) return true;

  const agent = await prisma.deviceAgent.findFirst({
    where: { deviceId, userId, isActive: true, role: { in: ['OWNER', 'AGENT'] } },
  });
  return !!agent;
}

// ─── Lead Rotator ────────────────────────────────────────────────────────────

/** Get next active agent for this device (round-robin). Returns userId. */
export async function getNextAgentForDevice(deviceId: string): Promise<string | null> {
  const agents = await prisma.deviceAgent.findMany({
    where: { deviceId, isActive: true, role: { in: ['OWNER', 'AGENT'] } },
    orderBy: { createdAt: 'asc' },
  });

  if (agents.length === 0) return null;

  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: { rotatorIndex: true, userId: true },
  });

  if (!device) return null;

  // Include device owner as first agent if not already in agent list
  const allAgents = [
    { userId: device.userId }, // owner always available
    ...agents.filter((a) => a.userId !== device.userId),
  ];

  const idx = (device.rotatorIndex ?? 0) % allAgents.length;
  const nextAgent = allAgents[idx];

  // Advance rotator pointer
  await prisma.device.update({
    where: { id: deviceId },
    data: { rotatorIndex: (idx + 1) % allAgents.length },
  });

  return nextAgent.userId;
}

// ─── Update device settings (also supports autoSaveContacts) ─────────────────
// (updateDeviceSettings already handles this via DeviceSettingsInput)

// ─── WhatsApp Groups ─────────────────────────────────────────────────────────

/** List all WhatsApp groups the device has joined */
export async function listWAGroups(userId: string, deviceId: string) {
  const device = await prisma.device.findFirst({ where: { id: deviceId, userId } });
  if (!device) {
    const err = new Error('Device not found') as any;
    err.status = 404; err.code = 'DEVICE_NOT_FOUND'; throw err;
  }

  const sock = getSession(deviceId);
  if (!sock) {
    const err = new Error('WhatsApp session is not active') as any;
    err.status = 503; err.code = 'SESSION_NOT_ACTIVE'; throw err;
  }

  const groups = await sock.groupFetchAllParticipating();
  return Object.values(groups).map((g: any) => ({
    jid: g.id,
    name: g.subject,
    description: g.desc ?? null,
    participantCount: (g.participants ?? []).length,
    createdAt: g.creation ? new Date(g.creation * 1000) : null,
  }));
}

/** Fetch members of a specific WhatsApp group */
export async function getWAGroupMembers(userId: string, deviceId: string, groupJid: string) {
  const device = await prisma.device.findFirst({ where: { id: deviceId, userId } });
  if (!device) {
    const err = new Error('Device not found') as any;
    err.status = 404; err.code = 'DEVICE_NOT_FOUND'; throw err;
  }

  const sock = getSession(deviceId);
  if (!sock) {
    const err = new Error('WhatsApp session is not active') as any;
    err.status = 503; err.code = 'SESSION_NOT_ACTIVE'; throw err;
  }

  const metadata = await sock.groupMetadata(groupJid);
  return {
    jid: metadata.id,
    name: metadata.subject,
    description: metadata.desc ?? null,
    members: (metadata.participants ?? []).map((p: any) => ({
      jid: p.id,
      phone: p.id.split('@')[0],
      isAdmin: p.admin === 'admin' || p.admin === 'superadmin',
      isSuperAdmin: p.admin === 'superadmin',
    })),
  };
}

/** Import all members of a WhatsApp group as contacts */
export async function importWAGroupContacts(
  userId: string,
  deviceId: string,
  groupJid: string,
  groupId?: string, // optional: add to contact group
) {
  const metadata = await getWAGroupMembers(userId, deviceId, groupJid);

  let created = 0, skipped = 0;

  for (const member of metadata.members) {
    const phone = formatPhone(member.phone);
    try {
      await prisma.contact.upsert({
        where: { userId_phone: { userId, phone } },
        create: { userId, name: phone, phone },
        update: {},
      });

      if (groupId) {
        const contact = await prisma.contact.findUnique({
          where: { userId_phone: { userId, phone } },
        });
        if (contact) {
          await prisma.contactGroupMember.upsert({
            where: { contactId_groupId: { contactId: contact.id, groupId } },
            create: { contactId: contact.id, groupId },
            update: {},
          });
        }
      }
      created++;
    } catch {
      skipped++;
    }
  }

  return {
    groupName: metadata.name,
    total: metadata.members.length,
    created,
    skipped,
  };
}

// ─── Warm-up daily send limit ────────────────────────────────────────────────

/** Throws WARMUP_LIMIT_REACHED (429) if the device's warm-up daily cap is hit. No-op if warm-up isn't active. */
export async function checkWarmupLimit(deviceId: string): Promise<void> {
  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: { warmupEnabled: true, warmupStartedAt: true },
  });
  if (!device?.warmupEnabled || !device.warmupStartedAt) return;

  const stage = getWarmupStage(device.warmupStartedAt);
  if (stage.maxMessagesPerDay === -1) return;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const sentToday = await prisma.message.count({
    where: { deviceId, createdAt: { gte: startOfDay }, status: { not: 'FAILED' } },
  });

  if (sentToday >= stage.maxMessagesPerDay) {
    const err = new Error(
      `Device is warming up (day ${stage.day}): daily limit of ${stage.maxMessagesPerDay} messages reached. Try again tomorrow.`,
    ) as any;
    err.status = 429;
    err.code = 'WARMUP_LIMIT_REACHED';
    err.details = { day: stage.day, maxMessagesPerDay: stage.maxMessagesPerDay, sentToday };
    throw err;
  }
}
