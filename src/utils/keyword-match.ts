import { KeywordMatchType } from '@prisma/client';

/** Shared by AutoReply keyword rules and chat flow triggers. */
export function matchesKeyword(text: string, keyword: string, matchType: KeywordMatchType): boolean {
  const normalizedText = text.toLowerCase().trim();
  const kw = keyword.toLowerCase();

  switch (matchType) {
    case 'EXACT':
      return normalizedText === kw;
    case 'CONTAINS':
      return normalizedText.includes(kw);
    case 'STARTS_WITH':
      return normalizedText.startsWith(kw);
    case 'REGEX':
      try {
        return new RegExp(keyword, 'i').test(text);
      } catch {
        return false;
      }
    case 'AI':
      // Keyword kosong atau "*" = tangkap semua pesan; selain itu berlaku sebagai filter CONTAINS
      return !kw || kw === '*' || normalizedText.includes(kw);
    default:
      return false;
  }
}
