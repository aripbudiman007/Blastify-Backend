import { prisma } from '../prisma/client';
import { getSession } from '../baileys/session';
import { getMessage } from '../baileys/store';
import { toJID } from '../utils/jid';
import { applyFreeWatermark } from '../utils/watermark';

function throwErr(status: number, code: string, msg: string): never {
  const err = new Error(msg) as any;
  err.status = status;
  err.code = code;
  throw err;
}

async function getIncomingForAction(userId: string, incomingId: string) {
  const incoming = await prisma.incomingMessage.findFirst({
    where: { id: incomingId, userId },
  });
  if (!incoming) throwErr(404, 'MESSAGE_NOT_FOUND', 'Incoming message not found');
  if (!incoming.waMessageId) throwErr(400, 'NO_WA_MESSAGE_ID', 'Message has no WhatsApp message id');

  const sock = getSession(incoming.deviceId);
  if (!sock) throwErr(503, 'SESSION_NOT_ACTIVE', 'WhatsApp session is not active for this device');

  const jid = incoming.isGroup && incoming.groupId ? incoming.groupId : toJID(incoming.from);
  const key = {
    remoteJid: jid,
    id: incoming.waMessageId!,
    fromMe: false,
    ...(incoming.isGroup ? { participant: toJID(incoming.from) } : {}),
  };

  return { incoming, sock, jid, key };
}

/** Kirim reaksi emoji ke pesan masuk. Emoji string kosong = hapus reaksi. */
export async function reactToIncoming(userId: string, incomingId: string, emoji: string) {
  const { sock, jid, key } = await getIncomingForAction(userId, incomingId);
  await sock.sendMessage(jid, { react: { text: emoji, key } });
  return { to: jid, emoji };
}

/** Balas pesan masuk dengan quote (reply bubble). */
export async function replyToIncoming(userId: string, incomingId: string, text: string) {
  const { incoming, sock, jid } = await getIncomingForAction(userId, incomingId);

  // Watermark plan FREE — hanya pada teks yang dikirim, bukan yang disimpan ke inbox
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true } });
  const outgoingText = applyFreeWatermark(text, user?.plan);

  // Pesan asli dari in-memory store — jika sudah hilang (restart), kirim tanpa quote
  const quoted = getMessage(incoming.deviceId, { id: incoming.waMessageId!, remoteJid: jid, fromMe: false });
  const sent = await sock.sendMessage(jid, { text: outgoingText }, quoted ? { quoted: quoted as any } : undefined);

  await prisma.incomingMessage
    .update({ where: { id: incoming.id }, data: { repliedWith: text, isRead: true } })
    .catch(() => { /* non-critical */ });

  return { to: jid, waMessageId: sent?.key?.id ?? null, quoted: Boolean(quoted) };
}

/** Tarik (delete for everyone) pesan keluar yang sudah terkirim. */
export async function revokeMessage(userId: string, messageId: string) {
  const message = await prisma.message.findFirst({ where: { id: messageId, userId } });
  if (!message) throwErr(404, 'MESSAGE_NOT_FOUND', 'Message not found');
  if (!message.waMessageId) {
    throwErr(400, 'NOT_SENT', 'Message has not been sent to WhatsApp (no waMessageId)');
  }

  const sock = getSession(message.deviceId);
  if (!sock) throwErr(503, 'SESSION_NOT_ACTIVE', 'WhatsApp session is not active for this device');

  const jid = toJID(message.to);
  await sock.sendMessage(jid, {
    delete: { remoteJid: jid, fromMe: true, id: message.waMessageId },
  });

  await prisma.message.update({
    where: { id: message.id },
    data: { errorMessage: 'Revoked (deleted for everyone) by user' },
  });

  return { messageId: message.id, waMessageId: message.waMessageId, to: jid };
}
