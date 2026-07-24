import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { successResponse, errorResponse } from '../utils/response';
import {
  listDevices,
  createDevice,
  getDevice,
  removeDevice,
  connectDevice,
  disconnectDevice,
  getDeviceQR,
  updateDeviceSettings,
  listDeviceAgents,
  addDeviceAgent,
  updateDeviceAgent,
  removeDeviceAgent,
  listWAGroups,
  getWAGroupMembers,
  importWAGroupContacts,
} from '../services/device.service';
import { DeviceAgentRole } from '@prisma/client';

export async function list(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const devices = await listDevices(req.user!.id);
    successResponse(res, { devices });
  } catch (err) {
    next(err);
  }
}

export async function create(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const device = await createDevice(req.user!.id, req.body.name, req.user!.plan);
    successResponse(res, { device }, 201);
  } catch (err) {
    next(err);
  }
}

export async function detail(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const device = await getDevice(req.user!.id, req.params.deviceId);
    successResponse(res, { device });
  } catch (err: any) {
    if (err.code === 'DEVICE_NOT_FOUND') {
      errorResponse(res, 404, 'DEVICE_NOT_FOUND', err.message);
      return;
    }
    next(err);
  }
}

export async function remove(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await removeDevice(req.user!.id, req.params.deviceId);
    successResponse(res, { message: 'Device deleted successfully' });
  } catch (err: any) {
    if (err.code === 'DEVICE_NOT_FOUND') {
      errorResponse(res, 404, 'DEVICE_NOT_FOUND', err.message);
      return;
    }
    next(err);
  }
}

export async function connect(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await connectDevice(req.user!.id, req.params.deviceId);
    successResponse(res, result);
  } catch (err: any) {
    if (err.code === 'DEVICE_NOT_FOUND') {
      errorResponse(res, 404, 'DEVICE_NOT_FOUND', err.message);
      return;
    }
    next(err);
  }
}

/**
 * Pairing code (alternatif QR): device harus sudah dalam proses connect.
 * Kode 8 karakter dimasukkan user di WhatsApp > Perangkat Tertaut > "Tautkan dengan nomor telepon".
 */
export async function pairingCode(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { prisma } = await import('../prisma/client');
    const { getSession } = await import('../baileys/session');
    const { formatPhone } = await import('../utils/jid');

    const device = await prisma.device.findFirst({
      where: { id: req.params.deviceId, userId: req.user!.id },
    });
    if (!device) {
      errorResponse(res, 404, 'DEVICE_NOT_FOUND', 'Device not found');
      return;
    }

    const sock = getSession(device.id);
    if (!sock) {
      errorResponse(res, 400, 'NOT_CONNECTING', 'Call POST /devices/:deviceId/connect first, then request a pairing code');
      return;
    }
    if (sock.authState.creds.registered) {
      errorResponse(res, 400, 'ALREADY_PAIRED', 'Device is already paired with WhatsApp');
      return;
    }

    const phone = formatPhone(req.body.phone);
    const code = await sock.requestPairingCode(phone);

    successResponse(res, {
      pairingCode: code,
      phone,
      message: 'Masukkan kode ini di WhatsApp > Perangkat Tertaut > Tautkan dengan nomor telepon',
    });
  } catch (err) { next(err); }
}

export async function disconnect(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await disconnectDevice(req.user!.id, req.params.deviceId);
    successResponse(res, result);
  } catch (err: any) {
    if (err.code === 'DEVICE_NOT_FOUND') {
      errorResponse(res, 404, 'DEVICE_NOT_FOUND', err.message);
      return;
    }
    next(err);
  }
}

export async function qrCode(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await getDeviceQR(req.user!.id, req.params.deviceId);
    successResponse(res, result);
  } catch (err: any) {
    if (err.code === 'DEVICE_NOT_FOUND') {
      errorResponse(res, 404, 'DEVICE_NOT_FOUND', err.message);
      return;
    }
    if (err.code === 'QR_NOT_READY') {
      errorResponse(res, 400, 'QR_NOT_READY', err.message);
      return;
    }
    next(err);
  }
}

// ─── Device Settings ──────────────────────────────────────────────────────────

export async function settings(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const device = await updateDeviceSettings(req.user!.id, req.params.deviceId as string, req.body);
    successResponse(res, { device });
  } catch (err: any) {
    if (err.code === 'DEVICE_NOT_FOUND') { errorResponse(res, 404, 'DEVICE_NOT_FOUND', err.message); return; }
    if (err.code === 'INVALID_DELAY') { errorResponse(res, 400, 'INVALID_DELAY', err.message); return; }
    next(err);
  }
}

// ─── Device Agents ────────────────────────────────────────────────────────────

export async function listAgents(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const agents = await listDeviceAgents(req.user!.id, req.params.deviceId as string);
    successResponse(res, { agents });
  } catch (err: any) {
    if (err.code === 'DEVICE_NOT_FOUND') { errorResponse(res, 404, 'DEVICE_NOT_FOUND', err.message); return; }
    next(err);
  }
}

export async function addAgent(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, role } = req.body;
    const agent = await addDeviceAgent(
      req.user!.id,
      req.params.deviceId as string,
      email,
      role as DeviceAgentRole,
    );
    successResponse(res, { agent }, 201);
  } catch (err: any) {
    const code4xx: Record<string, number> = {
      DEVICE_NOT_FOUND: 404, USER_NOT_FOUND: 404,
      CANNOT_ADD_SELF: 400, AGENT_ALREADY_EXISTS: 409,
    };
    if (err.code && code4xx[err.code]) {
      errorResponse(res, code4xx[err.code], err.code, err.message); return;
    }
    next(err);
  }
}

export async function updateAgent(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const agent = await updateDeviceAgent(
      req.user!.id,
      req.params.deviceId as string,
      req.params.agentId as string,
      req.body.role as DeviceAgentRole,
    );
    successResponse(res, { agent });
  } catch (err: any) {
    if (err.code === 'DEVICE_NOT_FOUND' || err.code === 'AGENT_NOT_FOUND') {
      errorResponse(res, 404, err.code, err.message); return;
    }
    next(err);
  }
}

export async function deleteAgent(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await removeDeviceAgent(
      req.user!.id,
      req.params.deviceId as string,
      req.params.agentId as string,
    );
    successResponse(res, { message: 'Agent removed' });
  } catch (err: any) {
    if (err.code === 'DEVICE_NOT_FOUND' || err.code === 'AGENT_NOT_FOUND') {
      errorResponse(res, 404, err.code, err.message); return;
    }
    next(err);
  }
}

// ─── WhatsApp Groups ──────────────────────────────────────────────────────────

function handleDeviceErr(err: any, res: Response, next: NextFunction) {
  const map: Record<string, number> = {
    DEVICE_NOT_FOUND: 404, SESSION_NOT_ACTIVE: 503,
  };
  if (err.code && map[err.code]) { errorResponse(res, map[err.code], err.code, err.message); return true; }
  return false;
}

export async function waGroups(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const groups = await listWAGroups(req.user!.id, req.params.deviceId as string);
    successResponse(res, { groups });
  } catch (err: any) {
    if (!handleDeviceErr(err, res, next)) next(err);
  }
}

export async function waGroupMembers(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await getWAGroupMembers(
      req.user!.id,
      req.params.deviceId as string,
      req.params.groupJid as string,
    );
    successResponse(res, data);
  } catch (err: any) {
    if (!handleDeviceErr(err, res, next)) next(err);
  }
}

export async function importGroupContacts(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await importWAGroupContacts(
      req.user!.id,
      req.params.deviceId as string,
      req.params.groupJid as string,
      req.body.contactGroupId,
    );
    successResponse(res, result);
  } catch (err: any) {
    if (!handleDeviceErr(err, res, next)) next(err);
  }
}
