import { isLateEntry } from './late-entry.ts';
import type { OpeningHoursValue } from './opening-hours.ts';
import { requestDayOf } from './request-day.ts';
import { addCivilDays } from './zoned-time.ts';

const MAX_POSITIVE_OFFSET_MS = 14 * 60 * 60 * 1000;
const MAX_NEGATIVE_OFFSET_MS = 12 * 60 * 60 * 1000;

/** بند خدمة نشط مع وقتي الزيارة والتسجيل ومنفذيها المطلوب إسنادهم. */
export interface ActiveLine {
  readonly lineId: string;
  readonly sessionId: string;
  readonly branchId: string;
  readonly occurredAt: Date;
  readonly recordedAt: Date;
  readonly businessTimezone: string;
  readonly performers: readonly { readonly employeeId: string; readonly shareBps: number }[];
}

/** مواعيد الفرع ومنطقته اللازمتان لتصفية جلسات يوم الطلب. */
export interface BranchSchedule {
  readonly openingHours: OpeningHoursValue | null;
  readonly timeZone: string;
}

/** زيارة واحدة مجمعة من بنودها النشطة بعد تطبيق قواعد يوم التقييم. */
export interface DaySession {
  readonly sessionId: string;
  readonly branchId: string;
  readonly occurredAt: Date;
  readonly recordedAt: Date;
  readonly lines: readonly ActiveLine[];
}

/**
 * يحسب أوسع نافذة UTC يمكن أن تحتوي يوماً محلياً وذيله الليلي في كل مناطق IANA.
 *
 * @param day يوم الطلب بصيغة YYYY-MM-DD
 * @returns from شامل وto غير شامل للتمرير إلى activeLines
 */
export function dayWindow(day: string): { from: Date; to: Date } {
  const start = Date.parse(`${day}T00:00:00Z`);
  const afterNextDay = Date.parse(`${addCivilDays(day, 2)}T00:00:00Z`);
  return {
    from: new Date(start - MAX_POSITIVE_OFFSET_MS),
    to: new Date(afterNextDay + MAX_NEGATIVE_OFFSET_MS),
  };
}

/**
 * يجمع البنود في زيارات ويحتفظ بيوم الطلب المطلوب والتسجيل غير المتأخر فقط، مرتباً زمنياً.
 *
 * @param lines البنود النشطة داخل نافذة البحث الواسعة
 * @param placeByBranch مواعيد ومنطقة كل فرع ظاهر في البنود
 * @param day يوم الطلب بصيغة YYYY-MM-DD
 * @returns الزيارات تصاعدياً بوقت الحدوث ثم sessionId؛ آخر عنصر هو الأحدث
 */
export function sessionsOfDay(
  lines: readonly ActiveLine[],
  placeByBranch: ReadonlyMap<string, BranchSchedule>,
  day: string,
): DaySession[] {
  const grouped = new Map<string, ActiveLine[]>();
  for (const line of lines) {
    const sessionLines = grouped.get(line.sessionId) ?? [];
    sessionLines.push(line);
    grouped.set(line.sessionId, sessionLines);
  }
  const sessions: DaySession[] = [];
  for (const [sessionId, sessionLines] of grouped) {
    const first = sessionLines[0];
    if (first === undefined) continue;
    const place = placeByBranch.get(first.branchId);
    if (place === undefined) throw new RangeError('BRANCH_SCHEDULE_MISSING');
    if (requestDayOf(first.occurredAt, place.timeZone, place.openingHours) !== day) continue;
    if (isLateEntry(first.recordedAt, day, place.timeZone, place.openingHours)) continue;
    sessions.push({
      sessionId,
      branchId: first.branchId,
      occurredAt: first.occurredAt,
      recordedAt: first.recordedAt,
      lines: sessionLines,
    });
  }
  return sessions.sort(
    (left, right) =>
      left.occurredAt.getTime() - right.occurredAt.getTime() ||
      left.sessionId.localeCompare(right.sessionId),
  );
}
