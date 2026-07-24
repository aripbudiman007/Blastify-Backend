import axios from 'axios';
import { prisma } from '../prisma/client';
import { logger } from '../config/logger';
import { matchesKeyword } from '../utils/keyword-match';
import { advanceFlow, FlowNode, FlowSessionState } from '../utils/flow-engine';
import { KeywordMatchType } from '@prisma/client';

const CANCEL_KEYWORDS = ['batal', 'cancel', 'stop', 'keluar'];
const SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000;

function throwNotFound(msg = 'Chat flow not found'): never {
  const err = new Error(msg) as any;
  err.status = 404;
  err.code = 'CHATFLOW_NOT_FOUND';
  throw err;
}

function validateNodes(nodes: FlowNode[], startNodeId: string): void {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    const err = new Error('nodes must be a non-empty array') as any;
    err.status = 400; err.code = 'INVALID_FLOW_NODES'; throw err;
  }
  const ids = new Set(nodes.map((n) => n.id));
  if (!ids.has(startNodeId)) {
    const err = new Error(`startNodeId "${startNodeId}" is not among the provided nodes`) as any;
    err.status = 400; err.code = 'INVALID_START_NODE'; throw err;
  }
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function listFlows(userId: string, deviceId?: string) {
  return prisma.chatFlow.findMany({
    where: { userId, ...(deviceId ? { deviceId } : {}) },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getFlow(userId: string, id: string) {
  const flow = await prisma.chatFlow.findFirst({ where: { id, userId } });
  if (!flow) throwNotFound();
  return flow;
}

export async function createFlow(
  userId: string,
  data: {
    deviceId: string;
    name: string;
    triggerKeyword: string;
    triggerMatchType?: KeywordMatchType;
    startNodeId: string;
    nodes: FlowNode[];
  },
) {
  const device = await prisma.device.findFirst({ where: { id: data.deviceId, userId } });
  if (!device) {
    const err = new Error('Device not found') as any;
    err.status = 404; err.code = 'DEVICE_NOT_FOUND'; throw err;
  }
  validateNodes(data.nodes, data.startNodeId);

  return prisma.chatFlow.create({ data: { userId, ...data, nodes: data.nodes as any } });
}

export async function updateFlow(
  userId: string,
  id: string,
  data: Partial<{
    name: string; triggerKeyword: string; triggerMatchType: KeywordMatchType;
    isActive: boolean; startNodeId: string; nodes: FlowNode[];
  }>,
) {
  const existing = await getFlow(userId, id);

  const nodes = (data.nodes ?? existing.nodes) as unknown as FlowNode[];
  const startNodeId = data.startNodeId ?? existing.startNodeId;
  if (data.nodes || data.startNodeId) validateNodes(nodes, startNodeId);

  return prisma.chatFlow.update({
    where: { id },
    data: { ...data, ...(data.nodes ? { nodes: data.nodes as any } : {}) },
  });
}

export async function deleteFlow(userId: string, id: string) {
  await getFlow(userId, id);
  await prisma.chatFlow.delete({ where: { id } });
}

export async function listFlowSessions(userId: string, flowId: string) {
  await getFlow(userId, flowId);
  return prisma.chatFlowSession.findMany({
    where: { flowId },
    orderBy: { lastInteractionAt: 'desc' },
    take: 100,
  });
}

// ─── Action node runner ────────────────────────────────────────────────────────

async function runFlowAction(
  userId: string,
  deviceId: string,
  contactPhone: string,
  node: Extract<FlowNode, { type: 'action' }>,
  variables: Record<string, string>,
): Promise<void> {
  try {
    switch (node.action) {
      case 'ADD_LABEL': {
        const labelName = node.params?.labelName;
        if (!labelName) return;
        const contact = await prisma.contact.upsert({
          where: { userId_phone: { userId, phone: contactPhone } },
          create: { userId, name: contactPhone, phone: contactPhone },
          update: {},
        });
        const label = await prisma.contactLabel.upsert({
          where: { userId_name: { userId, name: labelName } },
          create: { userId, name: labelName },
          update: {},
        });
        await prisma.contactLabelMember.upsert({
          where: { contactId_labelId: { contactId: contact.id, labelId: label.id } },
          create: { contactId: contact.id, labelId: label.id },
          update: {},
        });
        break;
      }
      case 'ASSIGN_AGENT': {
        const { getNextAgentForDevice } = await import('./device.service');
        const agentUserId = await getNextAgentForDevice(deviceId);
        if (!agentUserId) return;
        const { emitToUser } = await import('../socket');
        emitToUser(agentUserId, 'lead:assigned', {
          deviceId, from: contactPhone, message: 'Chat flow escalation', timestamp: Date.now(),
        });
        break;
      }
      case 'WEBHOOK': {
        const url = node.params?.url;
        if (!url) return;
        await axios.post(url, { deviceId, contactPhone, variables }, { timeout: 8_000 }).catch(() => {});
        break;
      }
      default:
        logger.warn(`Unknown chat flow action "${node.action}" — skipped`);
    }
  } catch (err: any) {
    logger.error(`Chat flow action "${node.action}" failed: ${err.message}`);
  }
}

// ─── Engine entrypoint (called from session.ts on every incoming message) ─────

/**
 * Feed an incoming WhatsApp message into the chat flow engine.
 * Returns true if a flow handled the message (caller should skip further
 * auto-reply keyword matching for this message), false otherwise.
 */
export async function handleIncomingForFlow(
  deviceId: string,
  contactPhone: string,
  text: string,
  send: (content: { text?: string; mediaUrl?: string }) => Promise<void>,
): Promise<boolean> {
  const existing = await prisma.chatFlowSession.findUnique({
    where: { deviceId_contactPhone: { deviceId, contactPhone } },
    include: { flow: true },
  });

  const isStale =
    existing?.status === 'ACTIVE' &&
    Date.now() - existing.lastInteractionAt.getTime() > SESSION_TIMEOUT_MS;

  if (existing && existing.status === 'ACTIVE' && !isStale) {
    if (CANCEL_KEYWORDS.includes(text.trim().toLowerCase())) {
      await prisma.chatFlowSession.update({
        where: { id: existing.id },
        data: { status: 'COMPLETED' },
      });
      await send({ text: 'Oke, sesi dibatalkan.' }).catch(() => {});
      return true;
    }

    if (!existing.flow.isActive) {
      await prisma.chatFlowSession.update({ where: { id: existing.id }, data: { status: 'COMPLETED' } });
      return false;
    }

    const nodes = existing.flow.nodes as unknown as FlowNode[];
    const state: FlowSessionState = {
      currentNodeId: existing.currentNodeId,
      variables: existing.variables as Record<string, string>,
      status: 'ACTIVE',
    };

    const result = await advanceFlow(nodes, state, text, {
      sendMessage: send,
      runAction: (node, vars) => runFlowAction(existing.flow.userId, deviceId, contactPhone, node, vars),
    });

    await prisma.chatFlowSession.update({
      where: { id: existing.id },
      data: {
        currentNodeId: result.currentNodeId,
        variables: result.variables,
        status: result.status,
        lastInteractionAt: new Date(),
      },
    });
    return true;
  }

  // No active session (or it just expired) — check if this message triggers a new flow.
  if (existing && isStale) {
    await prisma.chatFlowSession.update({ where: { id: existing.id }, data: { status: 'EXPIRED' } });
  }

  const flows = await prisma.chatFlow.findMany({ where: { deviceId, isActive: true } });
  const triggered = flows.find((f) => matchesKeyword(text, f.triggerKeyword, f.triggerMatchType));
  if (!triggered) return false;

  const nodes = triggered.nodes as unknown as FlowNode[];
  const initialState: FlowSessionState = { currentNodeId: triggered.startNodeId, variables: {}, status: 'ACTIVE' };

  const result = await advanceFlow(nodes, initialState, null, {
    sendMessage: send,
    runAction: (node, vars) => runFlowAction(triggered.userId, deviceId, contactPhone, node, vars),
  });

  await prisma.chatFlowSession.upsert({
    where: { deviceId_contactPhone: { deviceId, contactPhone } },
    create: {
      flowId: triggered.id,
      deviceId,
      contactPhone,
      currentNodeId: result.currentNodeId,
      variables: result.variables,
      status: result.status,
    },
    update: {
      flowId: triggered.id,
      currentNodeId: result.currentNodeId,
      variables: result.variables,
      status: result.status,
      lastInteractionAt: new Date(),
    },
  });
  return true;
}
