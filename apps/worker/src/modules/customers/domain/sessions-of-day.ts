import { isLateEntry } from './late-entry.ts';
import type { OpeningHoursValue } from './opening-hours.ts';
import {
  dayClose,
  isCoveredByPreviousDayOvernightRequest,
  requestDayOf,
  type PreviousDayOvernightRequest,
} from './request-day.ts';
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
  readonly requestDay?: string | null;
  readonly performers: readonly { readonly employeeId: string; readonly shareBps: number }[];
}

/** مواعيد الفرع ومنطقته اللازمتان لتصفية جلسات يوم الطلب. */
export interface BranchSchedule {
  readonly openingHours: OpeningHoursValue | null;
  readonly timeZone: string;
}

/** سياق طلبات قائمة يسمح بإسناد الزيارات الليلية القديمة غير الموسومة لليوم الصحيح ومنع امتصاصها لليوم التالي. */
export interface LegacyOvernightCoverage {
  readonly request?: PreviousDayOvernightRequest | undefined;
  readonly requestBranchTimeZone?: string | undefined;
  readonly previousDayRequest?: PreviousDayOvernightRequest | undefined;
  readonly previousRequestBranchTimeZone?: string | undefined;
}

/** سياق الموعد النهائي التاريخي المقيد بفرع الطلب لمنع تسرب السماح لفروع أخرى وبقائه بعد مسح الساعات. */
export interface HistoricalBranchCutoff {
  readonly branchId: string;
  readonly sendDeadline: Date | null;
}

/** زيارة واحدة مجمعة من بنودها النشطة بعد تطبيق قواعد يوم التقييم. */
export interface DaySession {
  readonly sessionId: string;
  readonly branchId: string;
  readonly occurredAt: Date;
  readonly recordedAt: Date;
  readonly requestDay?: string;
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

function resolveUnassignedLineDay(
  line: ActiveLine,
  place: BranchSchedule,
  day: string,
  legacyOvernight?: LegacyOvernightCoverage,
): string {
  const computed = requestDayOf(line.occurredAt, place.timeZone, place.openingHours);
  const nextCivilDay = addCivilDays(day, 1);
  const prevCivilDay = addCivilDays(day, -1);
  const visit = {
    branchId: line.branchId,
    occurredAt: line.occurredAt,
    recordedAt: line.recordedAt,
  };
  if (
    computed === nextCivilDay &&
    legacyOvernight?.request !== undefined &&
    legacyOvernight.request.businessDate === day &&
    isCoveredByPreviousDayOvernightRequest(
      visit,
      legacyOvernight.request,
      legacyOvernight.requestBranchTimeZone ?? place.timeZone,
    )
  ) {
    return day;
  }
  if (
    computed === day &&
    legacyOvernight?.previousDayRequest !== undefined &&
    legacyOvernight.previousDayRequest.businessDate === prevCivilDay &&
    isCoveredByPreviousDayOvernightRequest(
      visit,
      legacyOvernight.previousDayRequest,
      legacyOvernight.previousRequestBranchTimeZone ?? place.timeZone,
    )
  ) {
    return prevCivilDay;
  }
  return computed;
}

function cutoffPolicyForSession(
  first: ActiveLine,
  place: BranchSchedule,
  day: string,
  historicalCutoff: Date | HistoricalBranchCutoff | null | undefined,
): { readonly branchDeadline: Date | null; readonly preserveAnchored: boolean } {
  if (historicalCutoff instanceof Date) {
    return { branchDeadline: historicalCutoff, preserveAnchored: false };
  }
  if (historicalCutoff == null || historicalCutoff.branchId !== first.branchId) {
    return { branchDeadline: null, preserveAnchored: false };
  }
  return {
    branchDeadline: historicalCutoff.sendDeadline,
    preserveAnchored:
      first.requestDay === day &&
      historicalCutoff.sendDeadline === null &&
      dayClose(day, place.timeZone, place.openingHours) === null,
  };
}

/**
 * يجمع البنود في زيارات ويحتفظ بيوم الطلب المطلوب والتسجيل غير المتأخر فقط، مرتباً زمنياً.
 *
 * @param lines البنود النشطة داخل نافذة البحث الواسعة
 * @param placeByBranch مواعيد ومنطقة كل فرع ظاهر في البنود
 * @param day يوم الطلب بصيغة YYYY-MM-DD
 * @param historicalCutoff الموعد النهائي التاريخي المقيد بفرع الطلب لحفظ السماح الليلي بعد مسح الساعات
 * @param legacyOvernight سياق الطلبات القائمة لحسم انتماء الزيارات غير الموسومة عند تغير الساعات
 * @returns الزيارات تصاعدياً بوقت الحدوث ثم sessionId؛ آخر عنصر هو الأحدث
 */
export function sessionsOfDay(
  lines: readonly ActiveLine[],
  placeByBranch: ReadonlyMap<string, BranchSchedule>,
  day: string,
  historicalCutoff?: Date | HistoricalBranchCutoff | null | undefined,
  legacyOvernight?: LegacyOvernightCoverage,
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
    const sessionDay =
      first.requestDay ?? resolveUnassignedLineDay(first, place, day, legacyOvernight);
    if (sessionDay !== day) continue;
    const policy = cutoffPolicyForSession(first, place, day, historicalCutoff);
    if (
      isLateEntry(
        first.recordedAt,
        day,
        place.timeZone,
        place.openingHours,
        first.occurredAt,
        policy.branchDeadline,
        policy.preserveAnchored,
      )
    )
      continue;
    sessions.push({
      sessionId,
      branchId: first.branchId,
      occurredAt: first.occurredAt,
      recordedAt: first.recordedAt,
      requestDay: sessionDay,
      lines: sessionLines,
    });
  }
  return sessions.sort(
    (left, right) =>
      left.occurredAt.getTime() - right.occurredAt.getTime() ||
      left.sessionId.localeCompare(right.sessionId),
  );
}

/**
 * يستخرج معرّفات الزيارات غير المثبَّت يومها والتابعة ليوم الطلب المطلوب بترتيب قفل موحّد.
 *
 * @param lines البنود النشطة داخل نافذة البحث
 * @param placeByBranch خريطة مواعيد ومنطقة كل فرع ظاهر في البنود
 * @param day يوم الطلب بصيغة YYYY-MM-DD
 * @param extraSessionId زيارة محفِّزة لم يظهر لها يوم محفوظ بعد عند الحاجة لإدراجها في الترتيب
 * @param legacyOvernight سياق الطلب القائم لاسترداد الزيارات الليلية القديمة غير الموسومة بعد تعديل الساعات
 * @returns معرّفات الزيارات الفريدة مرتبة تصاعدياً لتفادي تعارض ترتيب الأقفال
 */
export function unassignedSessionIdsOfDay(
  lines: readonly ActiveLine[],
  placeByBranch: ReadonlyMap<string, BranchSchedule>,
  day: string,
  extraSessionId?: string,
  legacyOvernight?: LegacyOvernightCoverage,
): string[] {
  const pendingSessionIds = new Set<string>();
  const seenSessionIds = new Set<string>();
  const alreadyAssignedIds = new Set<string>();
  for (const line of lines) {
    seenSessionIds.add(line.sessionId);
    if (line.requestDay != null) {
      alreadyAssignedIds.add(line.sessionId);
      continue;
    }
    if (pendingSessionIds.has(line.sessionId)) continue;
    const place = placeByBranch.get(line.branchId);
    if (place === undefined) throw new RangeError('BRANCH_SCHEDULE_MISSING');
    const resolvedDay = resolveUnassignedLineDay(line, place, day, legacyOvernight);
    if (resolvedDay !== day) continue;
    const branchDeadline =
      legacyOvernight?.request?.branchId === line.branchId
        ? legacyOvernight.request.sendDeadline
        : null;
    if (
      !isLateEntry(
        line.recordedAt,
        day,
        place.timeZone,
        place.openingHours,
        line.occurredAt,
        branchDeadline,
      )
    ) {
      pendingSessionIds.add(line.sessionId);
    }
  }
  if (
    extraSessionId !== undefined &&
    !alreadyAssignedIds.has(extraSessionId) &&
    !seenSessionIds.has(extraSessionId)
  ) {
    pendingSessionIds.add(extraSessionId);
  }
  return [...pendingSessionIds].sort();
}

/**
 * يعكس أيام الطلب المثبَّتة حديثاً على البنود النشطة غير المحفوظ يومها بعد.
 *
 * @param lines البنود النشطة المقروءة داخل المعاملة
 * @param assignedBySessionId خريطة يوم الطلب المخزَّن لكل معرّف زيارة جرى تثبيته
 * @returns البنود مع تعبئة requestDay للزيارات المثبَّتة حديثاً
 */
export function withAssignedRequestDays(
  lines: readonly ActiveLine[],
  assignedBySessionId: ReadonlyMap<string, string>,
): readonly ActiveLine[] {
  if (assignedBySessionId.size === 0) return lines;
  return lines.map((line) =>
    line.requestDay != null || !assignedBySessionId.has(line.sessionId)
      ? line
      : { ...line, requestDay: assignedBySessionId.get(line.sessionId) ?? null },
  );
}
