import { proto, WAMessageKey } from '@whiskeysockets/baileys';

interface MessageStore {
  messages: Map<string, proto.IWebMessageInfo>;
}

const stores = new Map<string, MessageStore>();

export function getStore(deviceId: string): MessageStore {
  if (!stores.has(deviceId)) {
    stores.set(deviceId, { messages: new Map() });
  }
  return stores.get(deviceId)!;
}

export function deleteStore(deviceId: string): void {
  stores.delete(deviceId);
}

export function storeMessage(deviceId: string, message: proto.IWebMessageInfo): void {
  const store = getStore(deviceId);
  const id = message.key?.id;
  if (!id) return;
  store.messages.set(id, message);
}

export function getMessage(
  deviceId: string,
  key: WAMessageKey,
): proto.IWebMessageInfo | undefined {
  const store = getStore(deviceId);
  return store.messages.get(key.id!);
}
