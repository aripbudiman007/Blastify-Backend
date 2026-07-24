import { describe, it, expect } from 'vitest';
import { matchesKeyword } from './keyword-match';

describe('matchesKeyword', () => {
  it('EXACT requires an exact case-insensitive match', () => {
    expect(matchesKeyword('Halo', 'halo', 'EXACT')).toBe(true);
    expect(matchesKeyword('Halo dunia', 'halo', 'EXACT')).toBe(false);
  });

  it('CONTAINS matches a substring anywhere', () => {
    expect(matchesKeyword('mau tanya soal harga dong', 'harga', 'CONTAINS')).toBe(true);
    expect(matchesKeyword('mau tanya', 'harga', 'CONTAINS')).toBe(false);
  });

  it('STARTS_WITH anchors to the beginning', () => {
    expect(matchesKeyword('promo hari ini', 'promo', 'STARTS_WITH')).toBe(true);
    expect(matchesKeyword('lihat promo', 'promo', 'STARTS_WITH')).toBe(false);
  });

  it('REGEX applies the keyword as a case-insensitive pattern', () => {
    expect(matchesKeyword('order #12345', '^order #\\d+$', 'REGEX')).toBe(true);
    expect(matchesKeyword('order abc', '^order #\\d+$', 'REGEX')).toBe(false);
  });

  it('REGEX with an invalid pattern fails closed instead of throwing', () => {
    expect(matchesKeyword('anything', '(unterminated', 'REGEX')).toBe(false);
  });

  it('AI treats empty keyword or "*" as catch-all, otherwise behaves like CONTAINS', () => {
    expect(matchesKeyword('apa saja', '', 'AI')).toBe(true);
    expect(matchesKeyword('apa saja', '*', 'AI')).toBe(true);
    expect(matchesKeyword('mau tanya harga', 'harga', 'AI')).toBe(true);
    expect(matchesKeyword('mau tanya', 'harga', 'AI')).toBe(false);
  });
});
