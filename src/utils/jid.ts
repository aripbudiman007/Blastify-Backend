export function formatPhone(phone: string): string {
  let cleaned = phone.replace(/\D/g, '');

  if (cleaned.startsWith('0')) {
    cleaned = '62' + cleaned.slice(1);
  }

  if (!cleaned.startsWith('62') && cleaned.length <= 13) {
    cleaned = '62' + cleaned;
  }

  return cleaned;
}

export function toJID(phone: string): string {
  if (phone.includes('@')) {
    return phone;
  }

  if (/^\d+$/.test(phone) && phone.length > 15) {
    return `${phone}@g.us`;
  }

  const formatted = formatPhone(phone);
  return `${formatted}@s.whatsapp.net`;
}

export function isGroupJID(jid: string): boolean {
  return jid.endsWith('@g.us');
}

export function fromJID(jid: string): string {
  return jid.split('@')[0];
}
