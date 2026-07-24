import makeWASocket, {
  AuthenticationState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  SignalDataTypeMap,
  initAuthCreds,
  proto,
  BufferJSON,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { prisma } from '../prisma/client';
import { logger as appLogger } from '../config/logger';
import { encryptText, decryptText } from '../utils/crypto';
import { dispatch } from '../webhook/dispatcher';
import { storeMessage } from './store';
import { DeviceStatus } from '@prisma/client';
import pino from 'pino';

const pinoLogger = pino({ level: 'silent' });

export type WASocket = ReturnType<typeof makeWASocket>;

const sessions = new Map<string, WASocket>();

let _io: any = null;
export function setSocketIO(io: any): void {
  _io = io;
}

export async function loadAuthState(
  deviceId: string,
): Promise<{ state: AuthenticationState; saveState: () => Promise<void> }> {
  const device = await prisma.device.findUnique({ where: { id: deviceId } });

  let creds: AuthenticationState['creds'];
  let keysData: Record<string, any> = {};

  if (device?.sessionData) {
    try {
      const decrypted = decryptText(device.sessionData);
      const parsed = JSON.parse(decrypted, BufferJSON.reviver);
      creds = parsed.creds ?? initAuthCreds();
      keysData = parsed.keys ?? {};
    } catch {
      creds = initAuthCreds();
    }
  } else {
    creds = initAuthCreds();
  }

  // Shared closure over `creds` + `keysData` — used both by the key store's
  // `set()` (fired on signal key mutations) and by the `creds.update` socket
  // event (fired on credential mutations). Both must persist the SAME
  // keysData object, otherwise whichever fires last silently wipes the other's
  // writes since persistAuthState() does a full overwrite of sessionData.
  const saveState = () => persistAuthState(deviceId, creds, keysData);

  const keys = {
    get: async <T extends keyof SignalDataTypeMap>(
      type: T,
      ids: string[],
    ): Promise<{ [id: string]: SignalDataTypeMap[T] }> => {
      const data: { [id: string]: SignalDataTypeMap[T] } = {};
      for (const id of ids) {
        const value = keysData[`${type}-${id}`];
        if (value) {
          data[id] =
            type === 'app-state-sync-key'
              ? proto.Message.AppStateSyncKeyData.fromObject(value)
              : value;
        }
      }
      return data;
    },
    set: async (data: any): Promise<void> => {
      for (const [type, typeData] of Object.entries(data) as [string, any][]) {
        if (!typeData) continue;
        for (const [id, value] of Object.entries(typeData) as [string, any][]) {
          if (value) {
            keysData[`${type}-${id}`] = value;
          } else {
            delete keysData[`${type}-${id}`];
          }
        }
      }
      await saveState();
    },
  };

  return {
    state: { creds, keys: makeCacheableSignalKeyStore(keys, pinoLogger) },
    saveState,
  };
}

async function persistAuthState(
  deviceId: string,
  creds: AuthenticationState['creds'],
  keys: Record<string, any>,
): Promise<void> {
  try {
    const raw = JSON.stringify({ creds, keys }, BufferJSON.replacer);
    const encrypted = encryptText(raw);
    await prisma.device.update({
      where: { id: deviceId },
      data: { sessionData: encrypted },
    });
  } catch (err) {
    appLogger.error(`Failed to persist session for device ${deviceId}`, err);
  }
}

export async function createSession(deviceId: string): Promise<WASocket> {
  const existing = sessions.get(deviceId);
  if (existing) {
    appLogger.info(`Session already exists for device ${deviceId}, returning existing`);
    return existing;
  }

  appLogger.info(`Creating session for device ${deviceId}`);

  const { version } = await fetchLatestBaileysVersion();
  const { state: authState, saveState } = await loadAuthState(deviceId);

  await prisma.device.update({
    where: { id: deviceId },
    data: { status: DeviceStatus.CONNECTING },
  });

  const sock = makeWASocket({
    version,
    auth: authState,
    browser: ['WA Gateway', 'Chrome', '120.0.0'],
    connectTimeoutMs: 30_000,
    keepAliveIntervalMs: 15_000,
    retryRequestDelayMs: 500,
    logger: pinoLogger,
    getMessage: async (key) => {
      const store = (await import('./store')).getMessage(deviceId, key);
      return store?.message ?? undefined;
    },
  });

  sessions.set(deviceId, sock);

  sock.ev.on('creds.update', saveState);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      appLogger.info(`QR code generated for device ${deviceId}`);
      const qrcode = await import('qrcode');
      const qrBase64 = await qrcode.toDataURL(qr);

      await prisma.device.update({
        where: { id: deviceId },
        data: { status: DeviceStatus.QR_READY, qrCode: qrBase64 },
      });

      if (_io) {
        _io.to(`device:${deviceId}`).emit('qr', { deviceId, qr: qrBase64 });
      }

      await dispatch('device.qr', deviceId, { qr: qrBase64 });
    }

    if (connection === 'open') {
      appLogger.info(`Device ${deviceId} connected`);
      const phone = sock.user?.id?.split(':')[0] ?? null;

      // Start the warm-up clock the first time a warm-up-enabled device
      // connects. Never reset it on subsequent reconnects — the ramp tracks
      // the number's age on WhatsApp, not this session's uptime.
      const current = await prisma.device.findUnique({
        where: { id: deviceId },
        select: { warmupEnabled: true, warmupStartedAt: true },
      });

      await prisma.device.update({
        where: { id: deviceId },
        data: {
          status: DeviceStatus.CONNECTED,
          phone,
          qrCode: null,
          ...(current?.warmupEnabled && !current.warmupStartedAt
            ? { warmupStartedAt: new Date() }
            : {}),
        },
      });

      if (_io) {
        _io.to(`device:${deviceId}`).emit('connected', { deviceId, phone });
      }

      await dispatch('device.connected', deviceId, { phone });
    }

    if (connection === 'close') {
      const boom = lastDisconnect?.error as Boom | undefined;
      const statusCode = boom?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      appLogger.warn(`Device ${deviceId} disconnected. Code: ${statusCode}`);

      sessions.delete(deviceId);

      if (statusCode === DisconnectReason.loggedOut) {
        await prisma.device.update({
          where: { id: deviceId },
          data: { status: DeviceStatus.LOGGED_OUT, sessionData: null },
        });
        await dispatch('device.disconnected', deviceId, { reason: 'logged_out' });
      } else if (shouldReconnect) {
        appLogger.info(`Reconnecting device ${deviceId}...`);
        setTimeout(() => createSession(deviceId), 5_000);
        await dispatch('device.disconnected', deviceId, { reason: 'reconnecting' });
      } else {
        await prisma.device.update({
          where: { id: deviceId },
          data: { status: DeviceStatus.DISCONNECTED },
        });
        await dispatch('device.disconnected', deviceId, { reason: 'disconnected' });
      }

      if (_io) {
        _io.to(`device:${deviceId}`).emit('disconnected', { deviceId, statusCode });
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      storeMessage(deviceId, msg);

      if (msg.key.fromMe) continue;

      // ── Persist IncomingMessage to database ───────────────────────────────
      const remoteJid = msg.key.remoteJid ?? '';
      const isGroupMsg = remoteJid.endsWith('@g.us');
      const fromPhone = isGroupMsg
        ? (msg.key.participant ?? remoteJid).replace('@s.whatsapp.net', '')
        : remoteJid.replace('@s.whatsapp.net', '');

      try {
        const rawMsg = msg.message ?? {};
        let inType = 'text';
        let inContent = '';
        if (rawMsg.conversation) {
          inContent = rawMsg.conversation;
        } else if (rawMsg.extendedTextMessage?.text) {
          inContent = rawMsg.extendedTextMessage.text;
        } else if (rawMsg.imageMessage) {
          inType = 'image'; inContent = rawMsg.imageMessage.caption ?? '';
        } else if (rawMsg.videoMessage) {
          inType = 'video'; inContent = rawMsg.videoMessage.caption ?? '';
        } else if (rawMsg.documentMessage) {
          inType = 'document'; inContent = rawMsg.documentMessage.fileName ?? '';
        } else if (rawMsg.audioMessage) {
          inType = 'audio';
        } else if (rawMsg.stickerMessage) {
          inType = 'sticker';
        }

        const deviceRecord = await prisma.device.findUnique({
          where: { id: deviceId },
          select: { userId: true },
        });

        if (deviceRecord && msg.key.id) {
          await prisma.incomingMessage.upsert({
            where: { waMessageId: msg.key.id },
            update: {},
            create: {
              userId: deviceRecord.userId,
              deviceId,
              from: fromPhone,
              pushName: msg.pushName ?? null,
              type: inType,
              content: inContent,
              waMessageId: msg.key.id,
              isGroup: isGroupMsg,
              groupId: isGroupMsg ? remoteJid : null,
            },
          });

          if (_io) {
            _io.to(`user:${deviceRecord.userId}`).emit('incoming_message', {
              deviceId,
              from: fromPhone,
              pushName: msg.pushName,
              type: inType,
              content: inContent,
              isGroup: isGroupMsg,
              groupId: isGroupMsg ? remoteJid : null,
              createdAt: new Date(),
            });
          }
        }
      } catch { /* non-critical */ }
      // ── End persist IncomingMessage ───────────────────────────────────────

      // ── Extract clean payload (text vs media) ────────────────────────────
      const msgContent = msg.message ?? {};
      const msgTypeKey = Object.keys(msgContent)[0] ?? 'unknown';

      const extractPayload = () => {
        if (msgContent.conversation || msgContent.extendedTextMessage) {
          return {
            type: 'text',
            text: msgContent.conversation ?? msgContent.extendedTextMessage?.text ?? '',
          };
        }
        if (msgContent.imageMessage) {
          return { type: 'image', caption: msgContent.imageMessage.caption, mimeType: msgContent.imageMessage.mimetype, fileSize: Number(msgContent.imageMessage.fileLength ?? 0) };
        }
        if (msgContent.videoMessage) {
          return { type: 'video', caption: msgContent.videoMessage.caption, mimeType: msgContent.videoMessage.mimetype, fileSize: Number(msgContent.videoMessage.fileLength ?? 0) };
        }
        if (msgContent.audioMessage) {
          return { type: 'audio', mimeType: msgContent.audioMessage.mimetype, duration: msgContent.audioMessage.seconds, ptt: msgContent.audioMessage.ptt };
        }
        if (msgContent.documentMessage) {
          return { type: 'document', fileName: msgContent.documentMessage.fileName, mimeType: msgContent.documentMessage.mimetype, fileSize: Number(msgContent.documentMessage.fileLength ?? 0) };
        }
        if (msgContent.locationMessage) {
          return { type: 'location', latitude: msgContent.locationMessage.degreesLatitude, longitude: msgContent.locationMessage.degreesLongitude };
        }
        if (msgContent.listResponseMessage) {
          return { type: 'list_response', selectedId: msgContent.listResponseMessage.singleSelectReply?.selectedRowId, title: msgContent.listResponseMessage.title };
        }
        if (msgContent.buttonsResponseMessage) {
          return { type: 'button_response', selectedId: msgContent.buttonsResponseMessage.selectedButtonId, displayText: msgContent.buttonsResponseMessage.selectedDisplayText };
        }
        return { type: msgTypeKey };
      };

      const payload = {
        id: msg.key.id,
        from: msg.key.remoteJid,
        isGroup: msg.key.remoteJid?.endsWith('@g.us') ?? false,
        timestamp: msg.messageTimestamp,
        pushName: msg.pushName,
        ...extractPayload(),
      };

      await dispatch('message.received', deviceId, payload);

      if (_io) {
        _io.to(`device:${deviceId}`).emit('message', payload);
      }

      // ── Auto Save Contact + Read Receipt Simulation ───────────────────────
      // isGroupMsg already declared above from IncomingMessage block
      try {
        const deviceMeta = await prisma.device.findUnique({
          where: { id: deviceId },
          select: { userId: true, autoSaveContacts: true, readReceiptSimulation: true },
        });

        // Auto save contact (non-group only)
        if (!isGroupMsg && deviceMeta?.autoSaveContacts) {
          const phone = msg.key.remoteJid!.split('@')[0];
          await prisma.contact.upsert({
            where: { userId_phone: { userId: deviceMeta!.userId, phone } },
            create: { userId: deviceMeta!.userId, name: msg.pushName ?? phone, phone },
            update: msg.pushName ? { name: msg.pushName } : {},
          });
        }

        // Read receipt simulation: mark message as read after a realistic delay
        if (deviceMeta?.readReceiptSimulation && msg.key.remoteJid && msg.key.id) {
          // Delay 800ms–4s to simulate a human glancing at their phone
          const readDelayMs = 800 + Math.random() * 3_200;
          setTimeout(async () => {
            try {
              await sock.readMessages([{
                remoteJid: msg.key.remoteJid!,
                id: msg.key.id!,
                fromMe: false,
              }]);
              appLogger.debug(`Read receipt sent for msg ${msg.key.id} from ${msg.key.remoteJid}`);
            } catch { /* non-critical */ }
          }, readDelayMs);
        }
      } catch { /* non-critical */ }
      // ── End Auto Save Contact + Read Receipt ─────────────────────────────

      // ── Auto-reply engine (with bad words filter) ────────────────────────
      const incomingText =
        msg.message?.conversation ??
        msg.message?.extendedTextMessage?.text ??
        '';

      if (incomingText) {
        try {
          // Bad words filter: fetch device settings
          const deviceSettings = await prisma.device.findUnique({
            where: { id: deviceId },
            select: { badWordsEnabled: true, badWords: true },
          });

          if (deviceSettings?.badWordsEnabled && deviceSettings.badWords.length > 0) {
            const lower = incomingText.toLowerCase();
            const hasBadWord = deviceSettings.badWords.some((w) =>
              lower.includes(w.toLowerCase()),
            );
            if (hasBadWord) {
              appLogger.debug(`Bad word detected from ${msg.key.remoteJid}, skipping auto-reply`);
              continue; // skip auto-reply for this message
            }
          }

          // Chat flow engine (multi-step chatbot) takes priority over simple
          // keyword auto-reply — a contact already mid-flow, or whose message
          // matches a flow trigger, is handled here and skips findMatchingReply.
          const { handleIncomingForFlow } = await import('../services/chatflow.service');
          const flowContactPhone = msg.key.remoteJid!.split('@')[0];
          const flowHandled = await handleIncomingForFlow(
            deviceId,
            flowContactPhone,
            incomingText,
            async (content) => {
              if (content.mediaUrl) {
                await sock.sendMessage(msg.key.remoteJid!, {
                  image: { url: content.mediaUrl },
                  caption: content.text ?? '',
                });
              } else {
                await sock.sendMessage(msg.key.remoteJid!, { text: content.text ?? '' });
              }
            },
          );
          if (flowHandled) continue;

          const { findMatchingReply } = await import('../services/autoreply.service');
          const rule = await findMatchingReply(deviceId, incomingText);
          if (rule) {
            let replyText: string;
            let replyContent: any;

            if (rule.matchType === 'AI') {
              // AI reply — gated by plan (canAiReply), monthly quota, and provider config
              const { isAiEnabled, generateAiReply, buildConversationContext, hasAiQuota, incrementAiUsage } =
                await import('../services/ai.service');
              const { getPlanLimits } = await import('../middleware/plan.middleware');

              const owner = await prisma.device.findUnique({
                where: { id: deviceId },
                select: { userId: true, user: { select: { plan: true } } },
              });
              const limits = owner ? await getPlanLimits(owner.user.plan) : null;

              if (!isAiEnabled() || !owner || !limits?.canAiReply) {
                appLogger.debug(`AI auto-reply skipped for device ${deviceId} (enabled=${isAiEnabled()}, plan allows=${limits?.canAiReply})`);
                continue;
              }

              if (!(await hasAiQuota(owner.userId, limits.aiMonthlyReplies ?? 0))) {
                appLogger.info(`AI quota exhausted for user ${owner.userId} (plan ${owner.user.plan}) — AI auto-reply skipped`);
                continue;
              }

              const history = await buildConversationContext(deviceId, msg.key.remoteJid!);
              const generated = await generateAiReply(rule.replyContent, history, incomingText);
              if (!generated) continue; // AI failed — send nothing rather than a broken reply

              await incrementAiUsage(owner.userId).catch(() => { /* metering must not block the reply */ });

              replyText = generated;
              replyContent = { text: generated };
            } else {
              const { renderTemplate } = await import('../utils/template');
              replyText = renderTemplate(rule.replyContent, {
                name: msg.pushName ?? '',
                phone: msg.key.remoteJid?.split('@')[0] ?? '',
              });

              replyContent = (() => {
                switch (rule.replyType) {
                  case 'IMAGE':    return { image: { url: rule.replyMediaUrl! }, caption: replyText };
                  case 'VIDEO':    return { video: { url: rule.replyMediaUrl! }, caption: replyText };
                  case 'AUDIO':    return { audio: { url: rule.replyMediaUrl! }, mimetype: 'audio/mpeg', ptt: false };
                  case 'DOCUMENT': return { document: { url: rule.replyMediaUrl! }, fileName: replyText, mimetype: 'application/octet-stream' };
                  default:         return { text: replyText };
                }
              })();
            }

            // Watermark plan FREE (mis. user turun plan tapi rule lama masih aktif) —
            // hanya pada teks/caption keluar, replyText yang disimpan tetap bersih
            {
              const { applyFreeWatermark } = await import('../utils/watermark');
              const ruleOwner = await prisma.device.findUnique({
                where: { id: deviceId },
                select: { user: { select: { plan: true } } },
              });
              const ownerPlan = ruleOwner?.user.plan;
              if (typeof replyContent.text === 'string') {
                replyContent.text = applyFreeWatermark(replyContent.text, ownerPlan);
              } else if (typeof replyContent.caption === 'string') {
                replyContent.caption = applyFreeWatermark(replyContent.caption, ownerPlan);
              }
            }

            await sock.sendMessage(msg.key.remoteJid!, replyContent);
            appLogger.debug(`Auto-reply sent to ${msg.key.remoteJid} (rule: ${rule.name})`);

            // Simpan balasan ke inbox — dipakai sebagai konteks percakapan AI
            if (msg.key.id) {
              await prisma.incomingMessage
                .update({ where: { waMessageId: msg.key.id }, data: { repliedWith: replyText } })
                .catch(() => { /* non-critical */ });
            }

            // Lead rotator: assign incoming conversation to next agent
            const { getNextAgentForDevice } = await import('../services/device.service');
            const agentUserId = await getNextAgentForDevice(deviceId);
            if (agentUserId) {
              const { emitToUser } = await import('../socket');
              emitToUser(agentUserId, 'lead:assigned', {
                deviceId,
                from: msg.key.remoteJid,
                pushName: msg.pushName,
                message: incomingText,
                timestamp: msg.messageTimestamp,
              });
            }
          }
        } catch (err: any) {
          appLogger.error(`Auto-reply error: ${err.message}`);
        }
      }
      // ── End auto-reply ───────────────────────────────────────────────────
    }
  });

  sock.ev.on('messages.update', async (updates) => {
    for (const update of updates) {
      if (!update.update.status) continue;

      const statusMap: Record<number, string> = {
        2: 'message.sent',
        3: 'message.delivered',
        4: 'message.read',
      };

      const event = statusMap[update.update.status as number];
      if (!event) continue;

      const msgStatus =
        event === 'message.sent' ? 'SENT' : event === 'message.delivered' ? 'DELIVERED' : 'READ';

      await dispatch(event, deviceId, {
        messageId: update.key.id,
        to: update.key.remoteJid,
        status: update.update.status,
      });

      const updatedMessages = await prisma.message.findMany({
        where: { waMessageId: update.key.id ?? '' },
        select: { id: true, userId: true, broadcastId: true },
      });

      if (updatedMessages.length > 0) {
        await prisma.message.updateMany({
          where: { waMessageId: update.key.id ?? '' },
          data: { status: msgStatus },
        });

        // Emit message:status realtime per user
        const { emitToUser } = await import('../socket');
        for (const msg of updatedMessages) {
          emitToUser(msg.userId, 'message:status', {
            messageId: msg.id,
            waMessageId: update.key.id,
            deviceId,
            status: msgStatus,
            to: update.key.remoteJid,
          });
        }
      }
    }
  });

  return sock;
}

export function getSession(deviceId: string): WASocket | undefined {
  return sessions.get(deviceId);
}

export function getAllSessions(): Map<string, WASocket> {
  return sessions;
}

export async function deleteSession(deviceId: string): Promise<void> {
  const sock = sessions.get(deviceId);
  if (sock) {
    try {
      await sock.logout();
    } catch {
      sock.end(undefined);
    }
    sessions.delete(deviceId);
  }

  await prisma.device.update({
    where: { id: deviceId },
    data: { status: DeviceStatus.DISCONNECTED, sessionData: null, qrCode: null },
  });

  const { deleteStore } = await import('./store');
  deleteStore(deviceId);

  appLogger.info(`Session deleted for device ${deviceId}`);
}

export async function restoreAllSessions(): Promise<void> {
  const devices = await prisma.device.findMany({
    where: {
      status: { in: [DeviceStatus.CONNECTED, DeviceStatus.QR_READY] },
      sessionData: { not: null },
    },
  });

  appLogger.info(`Restoring ${devices.length} sessions...`);
  let restored = 0;

  for (const device of devices) {
    try {
      await createSession(device.id);
      restored++;
    } catch (err) {
      appLogger.error(`Failed to restore session for device ${device.id}`, err);
      await prisma.device.update({
        where: { id: device.id },
        data: { status: DeviceStatus.DISCONNECTED },
      });
    }
  }

  appLogger.info(`Restored ${restored}/${devices.length} sessions`);
}
