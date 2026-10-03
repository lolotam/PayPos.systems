import { describe, expect, it } from 'vitest';
import { formatInstant } from '../format-instant.js';

describe('permission timestamps', () => {
  it('keeps seconds, shifts the day at the branch boundary, and identifies the timezone', () => {
    const instant = new Date('2026-10-01T22:59:59Z');
    expect(formatInstant(instant, 'en', 'Asia/Kuwait')).toMatch(/Oct 2, 2026.*01:59:59.*GMT\+3/);
    expect(formatInstant(instant, 'en', 'UTC')).toMatch(/Oct 1, 2026.*10:59:59.*UTC/);
  });
});
