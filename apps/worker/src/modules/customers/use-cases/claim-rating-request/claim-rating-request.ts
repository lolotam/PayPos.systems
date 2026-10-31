import {
  decideClaim,
  decideClaimBeforeDayState,
  decideClaimOptOut,
  type StoredClaimSchedule,
} from '../../domain/claim-decision.ts';
import { displaySafeFirstWord } from '../../domain/display-name.ts';
import { performerLabel } from '../../domain/performer-label.ts';
import { expiresAt } from '../../domain/rating-link-expiry.ts';
import { dayWindow, sessionsOfDay, type BranchSchedule } from '../../domain/sessions-of-day.ts';
import { ratingRequestReadyPayload } from '../../events/published.ts';
import type { BranchScheduleHoursPort } from '../../ports/branch-schedule-hours.port.ts';
import type { BusinessNamesPort } from '../../ports/business-names.port.ts';
import type { Clock, IdGenerator } from '../../ports/clock.port.ts';
import type { DaySessionsPort } from '../../ports/day-sessions.port.ts';
import type { PerformerNamePort } from '../../ports/performer-name.port.ts';
import type { PerformerLabelPort } from '../../ports/performer-label.port.ts';
import type {
  DueRatingRequest,
  RatingClaimRepository,
  RatingCustomer,
} from '../../ports/rating-claim.repository.ts';
import type { RatingTokenPort } from '../../ports/rating-token.port.ts';
import type { RatingOutboxPort } from '../../ports/rating-outbox.port.ts';
import type { RatingRequestsSwitchPort } from '../../ports/rating-requests-switch.port.ts';

/** نتيجة محاولة المطالبة، وكلها تُقرأ من حالة الصف بعد القرار. */
export type ClaimOutcome =
  | 'NOT_FOUND'
  | 'SKIPPED'
  | 'NOT_DUE'
  | 'CLAIMED'
  | 'OPTED_OUT'
  | 'PAST_DEADLINE'
  | 'NO_ACTIVE_LINE'
  | 'REQUESTS_OFF'
  | 'RESCHEDULED'
  | 'TOKEN_UNAVAILABLE';

type ClaimCancellation = 'OPTED_OUT' | 'REQUESTS_OFF' | 'PAST_DEADLINE' | 'NO_ACTIVE_LINE';

export interface ClaimRatingRequestInput {
  readonly companyId: string;
  /** صف الطلب كما قرأته جولة الاستحقاق؛ المطالبة تعيد قراءته تحت القفل. */
  readonly request: DueRatingRequest;
}

export interface ClaimRatingRequestPorts<Transaction = unknown> {
  readonly switch: RatingRequestsSwitchPort<Transaction>;
  readonly hours: BranchScheduleHoursPort<Transaction>;
  readonly names: BusinessNamesPort<Transaction>;
  readonly daySessions: DaySessionsPort<Transaction>;
  readonly performers: PerformerNamePort<Transaction>;
  readonly label: PerformerLabelPort;
  readonly claims: RatingClaimRepository<Transaction>;
  readonly token: RatingTokenPort;
  readonly outbox: RatingOutboxPort<Transaction>;
}

/** يطالب بطلب التقييم: يعيد الحساب من المصدر الموثوق، ويثبّت الرابط والنسخة في معاملة واحدة. */
export class ClaimRatingRequest<Transaction = unknown> {
  constructor(
    private readonly ports: ClaimRatingRequestPorts<Transaction>,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(tx: Transaction, input: ClaimRatingRequestInput): Promise<ClaimOutcome> {
    const customer = await this.ports.claims.lockCustomer(
      tx,
      input.companyId,
      input.request.customerId,
    );
    if (customer === null) return 'NOT_FOUND';
    const locked = await this.ports.claims.lockRequest(tx, input.companyId, input.request.id);
    if (locked === null) return 'SKIPPED';
    if (locked.status !== 'SCHEDULED') return 'NOT_DUE';
    // الساعة بعد القفلين: القرار لازم يقيس الوقت وهو القفلين ماسكين الصف (D-B5).
    const now = this.clock.now();
    const optedOut = decideClaimOptOut(customer.optedOutAt);
    if (optedOut.kind === 'OPTED_OUT') {
      return this.cancel(tx, {
        companyId: input.companyId,
        request: locked,
        kind: 'OPTED_OUT',
        now,
      });
    }
    const enabled = await this.ports.switch.enabled(tx, input.companyId, locked.businessId);
    const early = decideClaimBeforeDayState({
      now,
      switchEnabled: enabled,
      optedOutAt: customer.optedOutAt,
      stored: {
        branchId: locked.branchId,
        dueAt: locked.dueAt,
        sendDeadline: locked.sendDeadline,
      },
    });
    if (early.kind !== 'READ_DAY_STATE') {
      return this.cancel(tx, {
        companyId: input.companyId,
        request: locked,
        kind: early.kind,
        now,
      });
    }
    return this.settle(tx, { companyId: input.companyId, request: locked, customer, now, enabled });
  }

  private async settle(
    tx: Transaction,
    input: {
      companyId: string;
      request: DueRatingRequest;
      customer: RatingCustomer;
      now: Date;
      enabled: boolean;
    },
  ): Promise<ClaimOutcome> {
    const state = await this.dayState(tx, input.companyId, input.request);
    const decision = decideClaim({
      now: input.now,
      switchEnabled: input.enabled,
      optedOutAt: input.customer.optedOutAt,
      stored: {
        branchId: input.request.branchId,
        dueAt: input.request.dueAt,
        sendDeadline: input.request.sendDeadline,
      },
      sessions: state.sessions,
      placeByBranch: state.placeByBranch,
    });
    if (
      decision.kind === 'REQUESTS_OFF' ||
      decision.kind === 'OPTED_OUT' ||
      decision.kind === 'PAST_DEADLINE' ||
      decision.kind === 'NO_ACTIVE_LINE'
    ) {
      return this.cancel(tx, { ...input, kind: decision.kind });
    }
    if (decision.kind === 'NOT_DUE') return 'NOT_DUE';
    if (decision.kind === 'RESCHEDULED') {
      await this.ports.claims.reschedule(
        tx,
        input.companyId,
        input.request.id,
        decision.schedule,
        input.now,
      );
      return 'RESCHEDULED';
    }
    return this.claim(
      tx,
      input.companyId,
      input.request,
      input.customer,
      decision.performers,
      decision.schedule,
      input.now,
    );
  }

  private async cancel(
    tx: Transaction,
    input: {
      companyId: string;
      request: DueRatingRequest;
      kind: ClaimCancellation;
      now: Date;
    },
  ): Promise<ClaimOutcome> {
    await this.ports.claims.cancel(tx, input.companyId, input.request.id, input.kind, input.now);
    return input.kind;
  }

  private async claim(
    tx: Transaction,
    companyId: string,
    request: DueRatingRequest,
    customer: RatingCustomer,
    performers: readonly string[],
    schedule: StoredClaimSchedule,
    now: Date,
  ): Promise<ClaimOutcome> {
    const token = this.ports.token.claim({ companyId, ratingRequestId: request.id });
    if (token === null) return 'TOKEN_UNAVAILABLE';
    const businessName = await this.businessName(
      tx,
      companyId,
      request.businessId,
      customer.locale,
    );
    const label = await this.performersLabel(
      tx,
      companyId,
      performers,
      businessName,
      customer.locale,
    );
    const eventId = this.ids.newId();
    await this.ports.claims.claim(tx, companyId, request.id, {
      branchId: schedule.branchId,
      dueAt: schedule.dueAt,
      sendDeadline: schedule.sendDeadline,
      tokenHash: token.tokenHash,
      tokenKeyVersion: token.keyVersion,
      claimedAt: now,
      expiresAt: expiresAt(now),
      readyEventId: eventId,
    });
    await this.ports.claims.snapshotPerformers(
      tx,
      companyId,
      request.id,
      request.businessId,
      performers.map((employeeId) => ({ id: this.ids.newId(), employeeId })),
    );
    await this.publishReady(tx, {
      companyId,
      request,
      customer,
      schedule,
      eventId,
      tokenKeyVersion: token.keyVersion,
      businessName,
      label,
    });
    return 'CLAIMED';
  }

  private async publishReady(
    tx: Transaction,
    input: {
      companyId: string;
      request: DueRatingRequest;
      customer: RatingCustomer;
      schedule: StoredClaimSchedule;
      eventId: string;
      tokenKeyVersion: number;
      businessName: string;
      label: string;
    },
  ): Promise<void> {
    const {
      companyId,
      request,
      customer,
      schedule,
      eventId,
      tokenKeyVersion,
      businessName,
      label,
    } = input;
    await this.ports.outbox.append(tx, eventId, {
      aggregateType: 'rating_request',
      aggregateId: request.id,
      eventType: 'RatingRequestReady',
      payload: ratingRequestReadyPayload({
        eventId,
        companyId,
        businessId: request.businessId,
        branchId: schedule.branchId,
        ratingRequestId: request.id,
        tokenKeyVersion,
        phone: customer.phone,
        locale: customer.locale,
        parameters: {
          customerFirstName: displaySafeFirstWord(customer.name),
          businessName,
          performers: label,
        },
        sendDeadline: schedule.sendDeadline,
      }),
    });
  }

  private async businessName(
    tx: Transaction,
    companyId: string,
    businessId: string,
    locale: 'ar' | 'en',
  ): Promise<string> {
    const names = await this.ports.names.names(tx, companyId, businessId);
    if (names === null) throw new Error('RATING_BUSINESS_NOT_FOUND');
    return this.ports.label.businessName(
      locale === 'ar' ? (names.name_ar ?? names.name_en) : names.name_en,
    );
  }

  private async performersLabel(
    tx: Transaction,
    companyId: string,
    performers: readonly string[],
    businessName: string,
    locale: 'ar' | 'en',
  ): Promise<string> {
    const names = await this.ports.performers.firstNames(tx, companyId, performers);
    const byEmployee = new Map(names.map((name) => [name.employeeId, name]));
    const choice = performerLabel(
      performers.map((employeeId) => byEmployee.get(employeeId) ?? { nameAr: null, nameEn: null }),
      locale,
    );
    return this.ports.label.format(choice, locale, businessName);
  }

  private async dayState(
    tx: Transaction,
    companyId: string,
    request: DueRatingRequest,
  ): Promise<{
    sessions: ReturnType<typeof sessionsOfDay>;
    placeByBranch: ReadonlyMap<string, BranchSchedule>;
  }> {
    const place = await this.ports.hours.hours(tx, companyId, request.branchId);
    if (place === null) throw new Error('RATING_BRANCH_NOT_FOUND');
    const window = dayWindow(request.businessDate);
    const lines = await this.ports.daySessions.activeLines(
      tx,
      companyId,
      request.businessId,
      request.customerId,
      window.from,
      window.to,
    );
    const placeByBranch = new Map<string, BranchSchedule>([[request.branchId, place]]);
    for (const branchId of new Set(lines.map((line) => line.branchId))) {
      if (placeByBranch.has(branchId)) continue;
      const branch = await this.ports.hours.hours(tx, companyId, branchId);
      if (branch === null) throw new Error('RATING_BRANCH_NOT_FOUND');
      placeByBranch.set(branchId, branch);
    }
    return { sessions: sessionsOfDay(lines, placeByBranch, request.businessDate), placeByBranch };
  }
}
