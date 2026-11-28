import { requestDayOf } from '../domain/request-day.ts';
import {
  dayWindow,
  sessionsOfDay,
  type ActiveLine,
  type BranchSchedule,
  type DaySession,
} from '../domain/sessions-of-day.ts';
import type { BranchScheduleHoursPort } from '../ports/branch-schedule-hours.port.ts';
import type { DaySessionsPort } from '../ports/day-sessions.port.ts';

/** مدخلات قراءة حالة زيارات يوم الطلب وتثبيت يوم أي زيارة لم يُحفظ يومها بعد. */
export interface ResolveDayStateInput<Transaction> {
  readonly tx: Transaction;
  readonly companyId: string;
  readonly businessId: string;
  readonly customerId: string;
  readonly day: string;
  readonly initialBranches: ReadonlyMap<string, BranchSchedule>;
  readonly hours: BranchScheduleHoursPort<Transaction>;
  readonly daySessions: DaySessionsPort<Transaction>;
}

/**
 * يقرأ بنود اليوم النشطة ومواعيد فروعها، ويثبّت يوم الطلب لأول مرة على أي زيارة بلا يوم محفوظ.
 *
 * @param input المعاملة ومفاتيح العميل واليوم والمنافذ المطلوبة
 * @returns زيارات اليوم المصنّفة مع خريطة مواعيد الفروع
 */
export async function resolveDayState<Transaction>(
  input: ResolveDayStateInput<Transaction>,
): Promise<{
  readonly sessions: DaySession[];
  readonly placeByBranch: ReadonlyMap<string, BranchSchedule>;
}> {
  const window = dayWindow(input.day);
  const lines = await input.daySessions.activeLines(
    input.tx,
    input.companyId,
    input.businessId,
    input.customerId,
    window.from,
    window.to,
  );
  const placeByBranch = new Map(input.initialBranches);
  for (const branchId of new Set(lines.map((line) => line.branchId))) {
    if (placeByBranch.has(branchId)) continue;
    const branch = await input.hours.hours(input.tx, input.companyId, branchId);
    if (branch === null) throw new Error('RATING_BRANCH_NOT_FOUND');
    placeByBranch.set(branchId, branch);
  }
  const resolvedLines = await assignMissingSessionDays(input, lines, placeByBranch);
  return { sessions: sessionsOfDay(resolvedLines, placeByBranch, input.day), placeByBranch };
}

async function assignMissingSessionDays<Transaction>(
  input: Pick<ResolveDayStateInput<Transaction>, 'tx' | 'companyId' | 'businessId' | 'daySessions'>,
  lines: readonly ActiveLine[],
  placeByBranch: ReadonlyMap<string, BranchSchedule>,
): Promise<readonly ActiveLine[]> {
  const assign = input.daySessions.assignRequestDay;
  if (assign === undefined) return lines;
  const sessionDayById = new Map<string, string>();
  for (const line of lines) {
    if (line.requestDay != null || sessionDayById.has(line.sessionId)) continue;
    const place = placeByBranch.get(line.branchId);
    if (place === undefined) throw new RangeError('BRANCH_SCHEDULE_MISSING');
    const computedDay = requestDayOf(line.occurredAt, place.timeZone, place.openingHours);
    sessionDayById.set(
      line.sessionId,
      await assign(input.tx, input.companyId, input.businessId, line.sessionId, computedDay),
    );
  }
  if (sessionDayById.size === 0) return lines;
  return lines.map((line) =>
    line.requestDay != null
      ? line
      : { ...line, requestDay: sessionDayById.get(line.sessionId) ?? null },
  );
}
