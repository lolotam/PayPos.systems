import { describe, expect, it } from 'vitest';

import { ratingComment } from '../customers/ratings.js';

describe('rating comment shape', () => {
  it.each([
    ['ASCII', 'a'],
    ['Arabic', 'ت'],
    ['astral', '😀'],
  ])('accepts 1000 and refuses 1001 %s code points', (_label, character) => {
    expect(ratingComment.safeParse(character.repeat(1000)).success).toBe(true);
    expect(ratingComment.safeParse(character.repeat(1001)).success).toBe(false);
  });

  it.each([
    ['U+0000', String.fromCharCode(0)],
    ['U+0001', String.fromCharCode(1)],
    ['U+0008', String.fromCharCode(8)],
    ['U+000B', String.fromCharCode(11)],
    ['U+000C', String.fromCharCode(12)],
    ['U+007F', String.fromCharCode(127)],
    ['U+0085', String.fromCharCode(133)],
  ])('refuses a comment carrying %s', (_label, character) => {
    expect(ratingComment.safeParse(`comment${character}`).success).toBe(false);
  });

  it('accepts a multi-line comment, a CRLF and a tab', () => {
    const lineFeed = String.fromCharCode(10);
    const carriageReturn = String.fromCharCode(13);
    const tab = String.fromCharCode(9);
    expect(ratingComment.safeParse(`first line${lineFeed}second line`).success).toBe(true);
    expect(
      ratingComment.safeParse(`first line${carriageReturn}${lineFeed}second line`).success,
    ).toBe(true);
    expect(ratingComment.safeParse(`first line${tab}second line`).success).toBe(true);
  });

  it('accepts a 1000-code-point comment of newlines and refuses 1001', () => {
    const newline = String.fromCharCode(10);
    expect(ratingComment.safeParse(newline.repeat(1000)).success).toBe(true);
    expect(ratingComment.safeParse(newline.repeat(1001)).success).toBe(false);
  });

  it('accepts an empty comment', () => {
    expect(ratingComment.parse('')).toBe('');
  });
});

describe('rating comment links and markup refused', () => {
  it.each([
    ['a URL with a scheme', 'see https://example.com'],
    ['an upper-case URL', 'HTTP://EXAMPLE.COM'],
    ['a bare www host', 'visit www.example.com'],
    ['a www host in brackets', 'Check (www.example.com)'],
    ['a Markdown link', '[click](x)'],
    ['a Markdown image', '![pic](x)'],
    ['an HTML tag with attributes', '<img src=x onerror=alert(1)>'],
    ['an HTML tag', '<b>bold</b>'],
    ['a self-closing HTML tag', 'line<br/>break'],
    ['a bare domain', 'visit example.com'],
    ['an upper-case bare domain', 'Visit EXAMPLE.COM'],
    ['a domain with a country TLD', 'shop.sa/path'],
    ['an ftp URL', 'ftp://example.com/file'],
    ['a mailto link', 'mailto:user@example.com'],
    ['an email address', 'contact me at a@mail.example.com'],
    ['a protocol-relative URL', '//example.com/x'],
    ['a file URL', 'file:///etc/passwd'],
    ['an opaque data URL', 'data:text/plain,hello'],
    ['a telephone link', 'tel:123'],
    ['a domain with a travel TLD', 'example.travel'],
    ['a domain with a news TLD', 'see example.news/today'],
    ['an SMS link', 'sms:+96550000000'],
    ['a WhatsApp link', 'WhatsApp:me'],
    ['a lowercase bare domain', 'example.com'],
    ['a mixed-case domain', 'Example.COM'],
    ['a fully upper-case domain', 'EXAMPLE.COM'],
    ['a service domain', 'service.me'],
  ])('refuses a comment with %s', (_label, comment) => {
    expect(ratingComment.safeParse(comment).success).toBe(false);
  });
});

describe('rating comment links and markup accepted', () => {
  it.each([
    ['a fraction', '5/5'],
    ['a comparison', 'a<b'],
    ['a spaced angle bracket', 'x < y'],
    ['Arabic with a line break', `ممتاز جداً${String.fromCharCode(10)}شكراً لكم`],
    ['a domain that is not a listed TLD', 'wow.example'],
    ['plain words', 'write a review: 5 stars'],
    ['an abbreviation', 'e.g. nice service'],
    ['a decimal number', '4.5 stars'],
    ['a sentence ending in a word', 'great service.thanks'],
    ['Arabic with a full stop', 'ممتاز جداً.شكراً'],
    ['an Arabic time', 'الساعة 5.30'],
    ['an abbreviated name', 'Dr. Sara'],
    ['trailing dots', 'ok...'],
    ['a scheme word with a space', 'data: 5'],
    ['a telephone word with a space', 'tel: 123 please'],
    ['a short abbreviation', 'e.g. nice'],
    ['a time without a space', '5.30pm'],
    ['a sentence break before a word', 'Great service.Me and my sister'],
    ['a sentence break before a pronoun', 'Thank you.Us girls'],
  ])('accepts a comment with %s', (_label, comment) => {
    expect(ratingComment.safeParse(comment).success).toBe(true);
  });
});

describe('rating comment cost', () => {
  // الـ package مالهوش أنواع Node، فبناخد الساعة من globalThis بنوع صريح.
  const clock = (): number =>
    (globalThis as { performance?: { now(): number } }).performance?.now() ?? Date.now();

  it('refuses a megabyte body on the length rule and stays fast', () => {
    const body = 'a.'.repeat(500_000);
    const started = clock();
    const result = ratingComment.safeParse(body);
    const elapsed = clock() - started;
    expect(result.success).toBe(false);
    expect(elapsed).toBeLessThan(200);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('At most 1000 characters');
    }
  });

  it('refuses a 2000-unit body on the length rule and stays fast', () => {
    const body = 'a.'.repeat(1000);
    const started = clock();
    const result = ratingComment.safeParse(body);
    expect(clock() - started).toBeLessThan(200);
    expect(result.success).toBe(false);
  });

  it('accepts a 1000-code-point body and stays fast', () => {
    const body = 'a.'.repeat(500);
    const started = clock();
    const result = ratingComment.safeParse(body);
    expect(clock() - started).toBeLessThan(200);
    expect(result.success).toBe(true);
  });

  it('refuses a 1000-code-point body that ends in a domain and stays fast', () => {
    const body = `${'x.'.repeat(498)}.com`;
    const started = clock();
    const result = ratingComment.safeParse(body);
    expect(clock() - started).toBeLessThan(200);
    expect(result.success).toBe(false);
  });
});
