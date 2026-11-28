import type { Tx } from '@pospay/db';
import { decideRequest, outsideBootstrapWindow } from '../../domain/schedule-decision.ts';
import { ratingSchedule } from '../../domain/rating-schedule.ts';
import {
  isCoveredByPreviousDayOvernightRequest,
  requestDayOf,
  SessionRequestDayMismatchError,
} from '../../domain/request-day.ts';
import {
  dayWindow,
  sessionsOfDay,
  unassignedSessionIdsOfDay,
  withAssignedRequestDays,
  type ActiveLine,
  type BranchSchedule,
  type DaySession,
  type LegacyOvernightCoverage,
} from '../../domain/sessions-of-day.ts';
import { addCivilDays } from '../../domain/zoned-time.ts';
import type { BranchScheduleHoursPort } from '../../ports/branch-schedule-hours.port.ts';
import type { Clock, IdGenerator } from '../../ports/clock.port.ts';
import type { DaySessionsPort } from '../../ports/day-sessions.port.ts';
import type {
  RatingRequestKey,
  RatingRequestRepository,
  RatingRequestRow,
} from '../../ports/rating-request.repository.ts';
import type { RatingRequestsSwitchPort } from '../../ports/rating-requests-switch.port.ts';

export { SessionRequestDayMismatchError };

export type ScheduleOutcome =
  | 'SWITCH_OFF'
  | 'NOTHING_TO_SCHEDULE'
  | 'LEFT_AS_IS'
  | 'SCHEDULED'
  | 'NO_ACTIVE_LINE'
  | 'PAST_DEADLINE';

export interface ScheduleRatingRequestInput {
  readonly companyId: string;
  readonly businessId: string;
  readonly customerId: string;
  readonly branchId: string;
  readonly occurredAt: Date;
  readonly recordedAt?: Date;
  readonly sessionId?: string;
  readonly requestDay?: string | null;
  readonly bootstrapCutoff?: Date;
}

export interface ScheduleRatingRequestPorts {
  readonly switch: RatingRequestsSwitchPort;
  readonly hours: BranchScheduleHoursPort;
  readonly daySessions: DaySessionsPort;
  readonly requests: RatingRequestRepository;
}

interface DayState {
  readonly sessions: readonly DaySession[];
  readonly placeByBranch: ReadonlyMap<string, BranchSchedule>;
  readonly lines: readonly ActiveLine[];
}

function sameSchedule(
  row: RatingRequestRow,
  next: { branchId: string; dueAt: Date; sendDeadline: Date | null },
): boolean {
  return (
    row.status === 'SCHEDULED' &&
    row.branchId === next.branchId &&
    row.dueAt.getTime() === next.dueAt.getTime() &&
    (row.sendDeadline?.getTime() ?? null) === (next.sendDeadline?.getTime() ?? null)
  );
}

/** يعيد حساب طلب يوم التقييم من حالة الزيارات الموثوقة تحت قفل الصف. */
export class ScheduleRatingRequest {
  constructor(
    private readonly ports: ScheduleRatingRequestPorts,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(tx: Tx, input: ScheduleRatingRequestInput): Promise<ScheduleOutcome> {
    if (!(await this.ports.switch.enabled(tx, input.companyId, input.businessId)))
      return 'SWITCH_OFF';
    const place = await this.ports.hours.hours(tx, input.companyId, input.branchId);
    if (place === null) throw new Error('RATING_BRANCH_NOT_FOUND');
    const storedDay =
      input.requestDay ??
      (input.sessionId !== undefined && this.ports.daySessions.readRequestDay !== undefined
        ? await this.ports.daySessions.readRequestDay(
            tx,
            input.companyId,
            input.businessId,
            input.sessionId,
          )
        : null);
    const day = storedDay ?? (await this.resolveUnassignedDay(tx, input, place));
    const key: RatingRequestKey = {
      companyId: input.companyId,
      businessId: input.businessId,
      customerId: input.customerId,
      businessDate: day,
    };
    const row = await this.lockOrInsert(tx, input, key, place, storedDay);
    if (row === null) return 'NOTHING_TO_SCHEDULE';
    if (
      row.status !== 'SCHEDULED' &&
      !(row.status === 'CANCELLED' && row.cancelReason === 'NO_ACTIVE_LINE')
    ) {
      await this.persistSingleInputSessionDay(tx, input, storedDay, day);
      return 'LEFT_AS_IS';
    }
    const extraSessionIdToAssign = storedDay === null ? input.sessionId : undefined;
    const state = await this.loadDayState(tx, input, day, place, true, extraSessionIdToAssign, row);
    const now = this.clock.now();
    const decision = decideRequest(state.sessions, state.placeByBranch, now, input.bootstrapCutoff);
    if (decision.kind === 'OUTSIDE_BOOTSTRAP_WINDOW') return 'LEFT_AS_IS';
    if (decision.kind === 'NO_ACTIVE_LINE') {
      if (row.status === 'SCHEDULED')
        await this.ports.requests.cancel(tx, key, 'NO_ACTIVE_LINE', now);
      return 'NO_ACTIVE_LINE';
    }
    if (decision.kind === 'PAST_DEADLINE') {
      await this.ports.requests.cancel(tx, key, 'PAST_DEADLINE', now);
      return 'PAST_DEADLINE';
    }
    if (sameSchedule(row, decision)) return 'SCHEDULED';
    await this.ports.requests.schedule(tx, key, decision, now);
    return 'SCHEDULED';
  }

  private async resolveUnassignedDay(
    tx: Tx,
    input: ScheduleRatingRequestInput,
    place: BranchSchedule,
  ): Promise<string> {
    const computedDay = requestDayOf(input.occurredAt, place.timeZone, place.openingHours);
    if (this.ports.requests.findPreviousDayRequest === undefined) return computedDay;
    const previous = await this.ports.requests.findPreviousDayRequest(tx, {
      companyId: input.companyId,
      businessId: input.businessId,
      customerId: input.customerId,
      previousDate: addCivilDays(computedDay, -1),
    });
    if (previous === null) return computedDay;
    const requestPlace =
      previous.branchId === input.branchId
        ? place
        : await this.ports.hours.hours(tx, input.companyId, previous.branchId);
    if (requestPlace === null) throw new Error('RATING_BRANCH_NOT_FOUND');
    return isCoveredByPreviousDayOvernightRequest(
      input.recordedAt === undefined
        ? { occurredAt: input.occurredAt }
        : { occurredAt: input.occurredAt, recordedAt: input.recordedAt },
      previous,
      requestPlace.timeZone,
    )
      ? previous.businessDate
      : computedDay;
  }

  private async lockOrInsert(
    tx: Tx,
    input: ScheduleRatingRequestInput,
    key: RatingRequestKey,
    place: BranchSchedule,
    storedDay: string | null,
  ): Promise<RatingRequestRow | null> {
    const existing = await this.ports.requests.lock(tx, key);
    if (existing !== null) return existing;
    const initial = await this.loadDayState(tx, input, key.businessDate, place, false);
    const latest = initial.sessions.at(-1);
    if (latest === undefined) {
      await this.persistSingleInputSessionDay(tx, input, storedDay, key.businessDate);
      return null;
    }
    const latestPlace = initial.placeByBranch.get(latest.branchId);
    if (latestPlace === undefined) throw new RangeError('BRANCH_SCHEDULE_MISSING');
    const schedule = ratingSchedule(latest, latestPlace.openingHours, latestPlace.timeZone);
    if (outsideBootstrapWindow(latest.occurredAt, schedule.sendDeadline, input.bootstrapCutoff)) {
      await this.persistSingleInputSessionDay(tx, input, storedDay, key.businessDate);
      return null;
    }
    await this.ports.requests.insertIfAbsent(tx, key, {
      id: this.ids.newId(),
      branchId: latest.branchId,
      ...schedule,
    });
    const inserted = await this.ports.requests.lock(tx, key);
    if (inserted === null) throw new Error('RATING_REQUEST_MISSING');
    return inserted;
  }

  private async persistSingleInputSessionDay(
    tx: Tx,
    input: ScheduleRatingRequestInput,
    storedDay: string | null,
    day: string,
  ): Promise<void> {
    if (
      storedDay !== null ||
      input.sessionId === undefined ||
      this.ports.daySessions.assignRequestDay === undefined
    )
      return;
    const persisted = await this.ports.daySessions.assignRequestDay(
      tx,
      input.companyId,
      input.businessId,
      input.sessionId,
      day,
    );
    if (persisted !== day)
      throw new SessionRequestDayMismatchError(input.sessionId, day, persisted);
  }

  private async loadDayState(
    tx: Tx,
    input: ScheduleRatingRequestInput,
    day: string,
    place: BranchSchedule,
    assignMissingDays: boolean,
    extraSessionIdToAssign?: string,
    requestRow?: RatingRequestRow,
  ): Promise<DayState> {
    const window = dayWindow(day);
    const lines = await this.ports.daySessions.activeLines(
      tx,
      input.companyId,
      input.businessId,
      input.customerId,
      window.from,
      window.to,
    );
    if (input.sessionId !== undefined) {
      const assignedInputLine = lines.find(
        (line) => line.sessionId === input.sessionId && line.requestDay != null,
      );
      if (assignedInputLine?.requestDay != null && assignedInputLine.requestDay !== day) {
        throw new SessionRequestDayMismatchError(
          input.sessionId,
          day,
          assignedInputLine.requestDay,
        );
      }
    }
    const placeByBranch = await this.loadBranchSchedules(tx, input, place, lines);
    const legacyOvernight = await this.legacyOvernightForRow(
      tx,
      input.companyId,
      day,
      placeByBranch,
      requestRow,
    );
    const resolvedLines = assignMissingDays
      ? await this.assignPendingSessionDays(
          tx,
          input,
          day,
          lines,
          placeByBranch,
          extraSessionIdToAssign,
          legacyOvernight,
        )
      : lines;
    return {
      sessions: sessionsOfDay(resolvedLines, placeByBranch, day, requestRow?.sendDeadline),
      placeByBranch,
      lines: resolvedLines,
    };
  }

  private async legacyOvernightForRow(
    tx: Tx,
    companyId: string,
    day: string,
    placeByBranch: ReadonlyMap<string, BranchSchedule>,
    requestRow?: RatingRequestRow,
  ): Promise<LegacyOvernightCoverage | undefined> {
    if (requestRow === undefined || requestRow.sendDeadline === null) return undefined;
    const requestPlace =
      placeByBranch.get(requestRow.branchId) ??
      (await this.ports.hours.hours(tx, companyId, requestRow.branchId));
    if (requestPlace === null) throw new Error('RATING_BRANCH_NOT_FOUND');
    return {
      request: {
        businessDate: day,
        dueAt: requestRow.dueAt,
        sendDeadline: requestRow.sendDeadline,
      },
      requestBranchTimeZone: requestPlace.timeZone,
    };
  }

  private async loadBranchSchedules(
    tx: Tx,
    input: ScheduleRatingRequestInput,
    place: BranchSchedule,
    lines: readonly ActiveLine[],
  ): Promise<Map<string, BranchSchedule>> {
    const placeByBranch = new Map<string, BranchSchedule>([[input.branchId, place]]);
    for (const branchId of new Set(lines.map((line) => line.branchId))) {
      if (placeByBranch.has(branchId)) continue;
      const branch = await this.ports.hours.hours(tx, input.companyId, branchId);
      if (branch === null) throw new Error('RATING_BRANCH_NOT_FOUND');
      placeByBranch.set(branchId, branch);
    }
    return placeByBranch;
  }

  private async assignPendingSessionDays(
    tx: Tx,
    input: ScheduleRatingRequestInput,
    day: string,
    lines: readonly ActiveLine[],
    placeByBranch: ReadonlyMap<string, BranchSchedule>,
    extraSessionIdToAssign?: string,
    legacyOvernight?: LegacyOvernightCoverage,
  ): Promise<readonly ActiveLine[]> {
    const assign = this.ports.daySessions.assignRequestDay;
    if (assign === undefined) return lines;
    const pendingSessionIds = unassignedSessionIdsOfDay(
      lines,
      placeByBranch,
      day,
      extraSessionIdToAssign,
      legacyOvernight,
    );
    if (pendingSessionIds.length === 0) return lines;
    const assignedBySessionId = new Map<string, string>();
    for (const sid of pendingSessionIds) {
      const persisted = await assign(tx, input.companyId, input.businessId, sid, day);
      if (sid === input.sessionId && persisted !== day) {
        throw new SessionRequestDayMismatchError(sid, day, persisted);
      }
      assignedBySessionId.set(sid, persisted);
    }
    return withAssignedRequestDays(lines, assignedBySessionId);
  }
}
