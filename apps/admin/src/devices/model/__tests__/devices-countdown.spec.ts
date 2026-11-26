import { describe, expect, it } from 'vitest';

import { formatCountdown, remainingSecondsUntil } from '../devices-countdown';

describe('the pairing-code countdown', () => {
  it('shows minutes and seconds', () => {
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(5)).toBe('00:05');
    expect(formatCountdown(65)).toBe('01:05');
    expect(formatCountdown(600)).toBe('10:00');
  });

  it('never counts below zero', () => {
    expect(formatCountdown(-1)).toBe('00:00');
    expect(formatCountdown(-120)).toBe('00:00');
  });

  it('rounds a fractional second up, so the code never dies a second early', () => {
    expect(formatCountdown(9.2)).toBe('00:09');
  });

  it('treats a broken expiry as no time left', () => {
    expect(remainingSecondsUntil('not-a-date', Date.now())).toBe(0);
  });

  it('counts the seconds left until the expiry', () => {
    const now = Date.parse('2026-11-26T10:00:00.000Z');
    expect(remainingSecondsUntil('2026-11-26T10:10:00.000Z', now)).toBe(600);
    expect(remainingSecondsUntil('2026-11-26T10:00:30.000Z', now)).toBe(30);
  });

  it('never returns a negative time after the expiry', () => {
    const now = Date.parse('2026-11-26T10:20:00.000Z');
    expect(remainingSecondsUntil('2026-11-26T10:10:00.000Z', now)).toBe(0);
  });
});
