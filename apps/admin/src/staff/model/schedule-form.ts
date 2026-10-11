import { createContext } from 'react';
import type { ScheduleGrid, ScheduleShift, SetScheduleInput } from '@pospay/contracts';

export const scheduleDayKeys = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'] as const;

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
    shifts:
      row.schedule?.shifts.map((s) => ({
        day: s.day,
        start: s.start,
        end: s.end,
        break_start: scheduleBreakValue(s.break_start),
        break_end: scheduleBreakValue(s.break_end),
      })) ?? [],
  };
}

export function scheduleBreakValue(value: string | null | undefined): string | null {
  return value || null;
}

// السيرفر هو اللي بيحكم على مكان البريك؛ الدالة دي بتختار قيمة مبدئية بس جوّه الوردية.
export function newScheduleBreak(start: string, end: string) {
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const from = minutes(start);
  const duration = (minutes(end) - from + 1440) % 1440;
  if (!Number.isFinite(duration) || duration < 3) return null;
  const preferredStart = (13 * 60 - from + 1440) % 1440;
  const preferredEnd = (14 * 60 - from + 1440) % 1440;
  if (0 < preferredStart && preferredStart < preferredEnd && preferredEnd < duration)
    return { break_start: '13:00', break_end: '14:00' };
  const time = (offset: number) => {
    const value = (from + offset) % 1440;
    return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  };
  return {
    break_start: time(Math.floor(duration / 3)),
    break_end: time(Math.floor((duration * 2) / 3)),
  };
}

// القيمة الأولى تطابق DEFAULT_MAX_SHIFTS_PER_DAY في staff/domain حتى تصل قيمة النشاط مع الشبكة.
export const ScheduleLimitContext = createContext(3);

export function newScheduleShift(day: number, count: number, defaults: readonly ScheduleShift[] = []) {
  const entry = count === 0 ? defaults.find((shift) => shift.day === day) : undefined;
  if (entry) return { ...entry };
  const times = [
    ['09:00', '13:00'],
    ['14:00', '18:00'],
    ['19:00', '23:00'],
    ['00:00', '04:00'],
  ];
  const [start = '09:00', end = '13:00'] = times[count] ?? [];
  return { day, start, end };
}
