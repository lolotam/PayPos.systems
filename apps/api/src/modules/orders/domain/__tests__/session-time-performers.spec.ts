import { describe, expect, it } from 'vitest';
import { sessionBusinessDate, sessionTime, validateAppendWindow, isLateEntry } from '../session-time.ts';
import { equalShares, performerWarnings, validateRecorderPerformers, validateShares } from '../session-performers.ts';

const at = (value: string) => new Date(value);
const now = at('2026-10-15T08:00:00.000Z');
describe('business date and append window', () => {
  it.each([['2026-10-14T21:30:00Z', '2026-10-15', false], ['2026-10-14T20:59:59.999Z', '2026-10-14', true], ['2026-09-01T00:00:00+03:00', '2026-09-01', true]])('date %s = %s', (instant, day, late) => expect(sessionTime(at(instant), now, 'Asia/Kuwait')).toMatchObject({ business_date: day, late }));
  it('defaults to fresh injected now; same-day earlier is not late', () => {
    expect(sessionTime(undefined, now, 'Asia/Kuwait').occurred_at).toBe(now);
    expect(isLateEntry('2026-10-15', '2026-10-15')).toBe(false);
    expect(isLateEntry('2026-10-14', '2026-10-15')).toBe(true);
  });
  it('refuses 1ms before local oldest boundary', () => expect(() => sessionTime(at('2026-08-31T20:59:59.999Z'), now, 'Asia/Kuwait')).toThrow('SESSION_TIME_TOO_OLD'));
  it.each([119999, 120000])('normalizes future tolerance %s', (ms) => expect(sessionTime(new Date(now.getTime() + ms), now, 'Asia/Kuwait').occurred_at).toBe(now));
  it('refuses 1ms beyond future tolerance', () => expect(() => sessionTime(new Date(now.getTime() + 120001), now, 'Asia/Kuwait')).toThrow('SESSION_TIME_IN_FUTURE'));
  it.each([['2026-01-15T00:00:00Z', '2025-12-01', '2025-11-30'], ['2026-03-01T00:00:00Z', '2026-02-01', '2026-01-31']])('month/year boundary at %s', (instant, oldest, invalid) => {
    expect(() => validateAppendWindow(oldest, at(instant), 'Asia/Kuwait')).not.toThrow();
    expect(() => validateAppendWindow(invalid, at(instant), 'Asia/Kuwait')).toThrow('SESSION_TIME_TOO_OLD');
  });
  it('append uses the fresh clock while preserving original date', () => expect(() => validateAppendWindow('2026-09-30', at('2026-11-01T00:00:00Z'), 'Asia/Kuwait')).toThrow('SESSION_TIME_TOO_OLD'));
  it('invalid date/zone refuses safely', () => {
    expect(() => sessionBusinessDate(now, 'Invalid/Zone')).toThrow('SESSION_TIME_INVALID');
    expect(() => sessionTime(at('invalid'), now, 'Asia/Kuwait')).toThrow('SESSION_TIME_INVALID');
  });
});
describe('performers', () => {
  it.each([[1, [10000]], [2, [5000, 5000]], [3, [3334, 3333, 3333]], [4, [2500, 2500, 2500, 2500]]])('equal count %s', (count, expected) => expect(equalShares(count)).toEqual(expected));
  it('allows explicit 70/30 and preserves order', () => expect(validateShares([{ employee_id: 'B', share_bps: 7000 }, { employee_id: 'A', share_bps: 3000 }])).toEqual([7000, 3000]));
  it('defaults all omitted with remainder to first input', () => expect(validateShares(['C', 'B', 'A'].map((employee_id) => ({ employee_id })))).toEqual([3334, 3333, 3333]));
  it.each([[], Array.from({ length: 5 }, (_, i) => ({ employee_id: String(i) })), [{ employee_id: 'A' }, { employee_id: 'A' }], [{ employee_id: 'A', share_bps: 10000 }, { employee_id: 'B' }], [{ employee_id: 'A', share_bps: 0 }], [{ employee_id: 'A', share_bps: 9999 }], [{ employee_id: 'A', share_bps: 10000.1 }]].map((performers) => ({ performers })))('rejects malformed shares %#', ({ performers }) => expect(() => validateShares(performers)).toThrow('SESSION_PERFORMER_SHARES_INVALID'));
  it.each([[true, false, false, false], [false, false, true, false], [true, true, false, true], [false, true, true, true]])('warning clock=%s leave=%s', (clocked_in, approved_leave, missing, leave) => expect(performerWarnings({ clocked_in, approved_leave })).toEqual({ not_clocked_in_warning: missing, approved_leave_warning: leave }));
  it('forbids linked recorder regardless of role; different/null links allowed', () => {
    expect(() => validateRecorderPerformers('recorder', [{ user_id: 'recorder' }])).toThrow('SESSION_PERFORMER_SELF_FORBIDDEN');
    expect(() => validateRecorderPerformers('recorder', [{ user_id: 'different' }, { user_id: null }])).not.toThrow();
  });
});
