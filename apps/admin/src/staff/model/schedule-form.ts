import { createContext } from 'react';
import type { ScheduleGrid, SetScheduleInput } from '@pospay/contracts';

export function branchCivilDate(timezone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function initialScheduleWeek(timezone: string, now: Date): string {
  const today = branchCivilDate(timezone, now);
  const at = new Date(`${today}T00:00:00Z`);
  const offset = (at.getUTCDay() + 1) % 7;
  at.setUTCDate(at.getUTCDate() - offset);
  return at.toISOString().slice(0, 10);
}
export function scheduleFormDefaults(
  row: ScheduleGrid['items'][number],
  week: string,
): SetScheduleInput {
  return {
    week_start: week,
    expected_revision: row.schedule?.revision ?? 0,
    shifts: row.schedule?.shifts.map((s) => ({ day: s.day, start: s.start, end: s.end })) ?? [],
  };
}

export const ScheduleLimitContext = createContext(3);

export function newScheduleShift(day: number, count: number) {
  const times = [
    ['09:00', '13:00'], ['14:00', '18:00'], ['19:00', '23:00'], ['00:00', '04:00'],
  ];
  const [start = '09:00', end = '13:00'] = times[count] ?? [];
  return { day, start, end };
}
