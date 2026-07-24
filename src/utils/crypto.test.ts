import { describe, it, expect } from 'vitest';
import { encryptText, decryptText, generateApiKey, hashApiKey } from './crypto';

describe('encryptText / decryptText', () => {
  it('round-trips arbitrary text', () => {
    const plaintext = JSON.stringify({ creds: { foo: 'bar' }, keys: { 'pre-key-1': { a: 1 } } });
    const encrypted = encryptText(plaintext);
    expect(decryptText(encrypted)).toBe(plaintext);
  });

  it('produces a different ciphertext each call (random IV)', () => {
    const a = encryptText('same input');
    const b = encryptText('same input');
    expect(a).not.toBe(b);
    expect(decryptText(a)).toBe('same input');
    expect(decryptText(b)).toBe('same input');
  });

  it('fails to decrypt tampered ciphertext', () => {
    const encrypted = encryptText('sensitive session data');
    const bytes = Buffer.from(encrypted, 'base64');
    bytes[bytes.length - 1] ^= 0xff; // flip a bit in the ciphertext
    expect(() => decryptText(bytes.toString('base64'))).toThrow();
  });
});

describe('generateApiKey / hashApiKey', () => {
  it('generates unique keys', () => {
    expect(generateApiKey()).not.toBe(generateApiKey());
  });

  it('hashApiKey is deterministic', () => {
    const key = generateApiKey();
    expect(hashApiKey(key)).toBe(hashApiKey(key));
  });
});
