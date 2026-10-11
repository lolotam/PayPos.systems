import { describe, expect, it } from 'vitest';
import { contractedMinutes, dayDiffersFromDefault, defaultShiftMinutes } from '../default-shifts.js';

const entry = { day: 0, start: '09:00', end: '17:00', break_start: '13:00', break_end: '14:00' };
describe('default working hours', () => {
  it.each([['09:00', '17:00', 480], ['22:00', '06:00', 480], ['10:00', '22:00', 720]])(
    'counts the break in %s–%s', (start, end, minutes) => {
      expect(defaultShiftMinutes({ ...entry, start, end })).toBe(minutes);
    },
  );
  it('sums Sara Salmiya October 2026 to 228 hours, using caller-filtered dates', () => {
    const entries = Array.from({ length: 6 }, (_, day) => ({ ...entry, day, end: day === 5 ? '21:00' : '17:00' }));
    const dates = Array.from({ length: 31 }, (_, index) => ({ weekday: (new Date(Date.UTC(2026, 9, index + 1)).getUTCDay() + 1) % 7 }));
    expect(contractedMinutes(entries, dates)).toBe(13680);
    expect(contractedMinutes([], dates)).toBe(0);
    expect(contractedMinutes(entries, [])).toBe(0);
    expect(contractedMinutes(entries, [{ weekday: 5 }])).toBe(720);
  });
  it('never warns on an empty day or a missing default', () => {
    expect(dayDiffersFromDefault([], entry)).toBe(false);
    expect(dayDiffersFromDefault([entry], null)).toBe(false);
    expect(dayDiffersFromDefault([entry], entry)).toBe(false);
    expect(dayDiffersFromDefault([{ ...entry, break_start: null, break_end: null }], { ...entry, break_start: null, break_end: null })).toBe(false);
  });
  it.each([{ start: '10:00' }, { end: '18:00' }, { break_start: '12:00' }, { break_end: '15:00' }, { break_start: null, break_end: null }])(
    'warns for a different time or break %j', (change) => expect(dayDiffersFromDefault([{ ...entry, ...change }], entry)).toBe(true),
  );
  it('warns for two shifts and for an added break', () => {
    expect(dayDiffersFromDefault([entry, entry], entry)).toBe(true);
    expect(dayDiffersFromDefault([entry], { ...entry, break_start: null, break_end: null })).toBe(true);
  });
});
