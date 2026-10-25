import type { Tx } from '@pospay/db';
import { decideRequest, outsideBootstrapWindow } from '../../domain/schedule-decision.ts';
import { ratingSchedule } from '../../domain/rating-schedule.ts';
import { requestDayOf } from '../../domain/request-day.ts';
import {
  dayWindow,
  sessionsOfDay,
  type BranchSchedule,
  type DaySession,
} from '../../domain/sessions-of-day.ts';
import type { BranchScheduleHoursPort } from '../../ports/branch-schedule-hours.port.ts';
import type { Clock, IdGenerator } from '../../ports/clock.port.ts';
import type { DaySessionsPort } from '../../ports/day-sessions.port.ts';
import type {
  RatingRequestKey,
  RatingRequestRepository,
  RatingRequestRow,
} from '../../ports/rating-request.repository.ts';
import type { RatingRequestsSwitchPort } from '../../ports/rating-requests-switch.port.ts';

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
    const day = requestDayOf(input.occurredAt, place.timeZone, place.openingHours);
    const key: RatingRequestKey = {
      companyId: input.companyId,
      businessId: input.businessId,
      customerId: input.customerId,
      businessDate: day,
    };
    const row = await this.lockOrInsert(tx, input, key, place);
    if (row === null) return 'NOTHING_TO_SCHEDULE';
    if (
      row.status !== 'SCHEDULED' &&
      !(row.status === 'CANCELLED' && row.cancelReason === 'NO_ACTIVE_LINE')
    )
      return 'LEFT_AS_IS';
    const state = await this.dayState(tx, input, day, place);
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

  private async lockOrInsert(
    tx: Tx,
    input: ScheduleRatingRequestInput,
    key: RatingRequestKey,
    place: BranchSchedule,
  ): Promise<RatingRequestRow | null> {
    const existing = await this.ports.requests.lock(tx, key);
    if (existing !== null) return existing;
    const initial = await this.dayState(tx, input, key.businessDate, place);
    const latest = initial.sessions.at(-1);
    if (latest === undefined) return null;
    const latestPlace = initial.placeByBranch.get(latest.branchId);
    if (latestPlace === undefined) throw new RangeError('BRANCH_SCHEDULE_MISSING');
    const schedule = ratingSchedule(latest, latestPlace.openingHours, latestPlace.timeZone);
    if (outsideBootstrapWindow(latest.occurredAt, schedule.sendDeadline, input.bootstrapCutoff))
      return null;
    await this.ports.requests.insertIfAbsent(tx, key, {
      id: this.ids.newId(),
      branchId: latest.branchId,
      ...schedule,
    });
    const inserted = await this.ports.requests.lock(tx, key);
    if (inserted === null) throw new Error('RATING_REQUEST_MISSING');
    return inserted;
  }

  private async dayState(
    tx: Tx,
    input: ScheduleRatingRequestInput,
    day: string,
    place: BranchSchedule,
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
    const placeByBranch = new Map<string, BranchSchedule>([[input.branchId, place]]);
    const branchIds = new Set(lines.map((line) => line.branchId));
    for (const branchId of branchIds) {
      if (placeByBranch.has(branchId)) continue;
      const branch = await this.ports.hours.hours(tx, input.companyId, branchId);
      if (branch === null) throw new Error('RATING_BRANCH_NOT_FOUND');
      placeByBranch.set(branchId, branch);
    }
    return { sessions: sessionsOfDay(lines, placeByBranch, day), placeByBranch };
  }
}
