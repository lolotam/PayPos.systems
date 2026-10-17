import { describe, expect, it } from 'vitest';
import { assertTipWindowOpen, tipWindowOpen } from '../tip-window.ts';

const at = (value: string) => new Date(value);
const october = at('2026-10-15T08:00:00.000Z');

describe('tip recording window', () => {
  it('is open for today', () => {
    expect(tipWindowOpen('2026-10-15', october, 'Asia/Kuwait')).toBe(true);
    expect(() => assertTipWindowOpen('2026-10-15', october, 'Asia/Kuwait')).not.toThrow();
  });

  it('is open on the first day of the previous month', () => {
    expect(tipWindowOpen('2026-09-01', october, 'Asia/Kuwait')).toBe(true);
    expect(() => assertTipWindowOpen('2026-09-01', october, 'Asia/Kuwait')).not.toThrow();
  });

  it('is closed on the last day of the month before that', () => {
    expect(tipWindowOpen('2026-08-31', october, 'Asia/Kuwait')).toBe(false);
    expect(() => assertTipWindowOpen('2026-08-31', october, 'Asia/Kuwait')).toThrow(
      expect.objectContaining({ code: 'TIP_WINDOW_CLOSED' }),
    );
  });

  it('rolls the January window into the previous year', () => {
    const now = at('2026-01-15T12:00:00+03:00');
    expect(tipWindowOpen('2025-12-01', now, 'Asia/Kuwait')).toBe(true);
    expect(tipWindowOpen('2025-11-30', now, 'Asia/Kuwait')).toBe(false);
    expect(() => assertTipWindowOpen('2025-11-30', now, 'Asia/Kuwait')).toThrow(
      'TIP_WINDOW_CLOSED',
    );
  });

  it('uses the Asia/Kuwait date around midnight rather than the UTC date', () => {
    const now = at('2026-09-30T21:30:00.000Z');
    expect(tipWindowOpen('2026-10-01', now, 'Asia/Kuwait')).toBe(true);
    expect(tipWindowOpen('2026-09-01', now, 'Asia/Kuwait')).toBe(true);
    expect(tipWindowOpen('2026-08-31', now, 'Asia/Kuwait')).toBe(false);
  });

  it('has no approved-period input, so approval cannot close or open the window', () => {
    expect(tipWindowOpen.length).toBe(3);
    expect(assertTipWindowOpen.length).toBe(3);
    expect(tipWindowOpen('2026-10-15', october, 'Asia/Kuwait')).toBe(true);
    expect(tipWindowOpen('2026-08-31', october, 'Asia/Kuwait')).toBe(false);
  });

  it('does not turn an invalid timezone into a closed tip window', () => {
    expect(() => tipWindowOpen('2026-10-15', october, 'Invalid/Zone')).toThrow(
      'SESSION_TIME_INVALID',
    );
    expect(() => assertTipWindowOpen('2026-10-15', october, 'Invalid/Zone')).toThrow(
      'SESSION_TIME_INVALID',
    );
  });
});
