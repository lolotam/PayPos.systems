import type { Tx } from '@pospay/db';
import { decideClaim, type StoredClaimSchedule } from '../../domain/claim-decision.ts';
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

export interface ClaimRatingRequestInput {
  readonly companyId: string;
  /** صف الطلب كما قرأته جولة الاستحقاق؛ المطالبة تعيد قراءته تحت القفل. */
  readonly request: DueRatingRequest;
}

export interface ClaimRatingRequestPorts {
  readonly switch: RatingRequestsSwitchPort;
  readonly hours: BranchScheduleHoursPort;
  readonly names: BusinessNamesPort;
  readonly daySessions: DaySessionsPort;
  readonly performers: PerformerNamePort;
  readonly label: PerformerLabelPort;
  readonly claims: RatingClaimRepository;
  readonly token: RatingTokenPort;
  readonly outbox: RatingOutboxPort;
}

/** يطالب بطلب التقييم: يعيد الحساب من المصدر الموثوق، ويثبّت الرابط والنسخة في معاملة واحدة. */
export class ClaimRatingRequest {
  constructor(
    private readonly ports: ClaimRatingRequestPorts,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(tx: Tx, input: ClaimRatingRequestInput): Promise<ClaimOutcome> {
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
    const enabled = await this.ports.switch.enabled(tx, input.companyId, locked.businessId);
    const state = await this.dayState(tx, input.companyId, locked);
    const decision = decideClaim({
      now,
      switchEnabled: enabled,
      optedOutAt: customer.optedOutAt,
      stored: {
        branchId: locked.branchId,
        dueAt: locked.dueAt,
        sendDeadline: locked.sendDeadline,
      },
      sessions: state.sessions,
      placeByBranch: state.placeByBranch,
    });
    if (decision.kind === 'REQUESTS_OFF') {
      await this.ports.claims.cancel(tx, input.companyId, locked.id, 'REQUESTS_OFF', now);
      return 'REQUESTS_OFF';
    }
    if (decision.kind === 'OPTED_OUT') {
      await this.ports.claims.cancel(tx, input.companyId, locked.id, 'OPTED_OUT', now);
      return 'OPTED_OUT';
    }
    if (decision.kind === 'PAST_DEADLINE') {
      await this.ports.claims.cancel(tx, input.companyId, locked.id, 'PAST_DEADLINE', now);
      return 'PAST_DEADLINE';
    }
    if (decision.kind === 'NO_ACTIVE_LINE') {
      await this.ports.claims.cancel(tx, input.companyId, locked.id, 'NO_ACTIVE_LINE', now);
      return 'NO_ACTIVE_LINE';
    }
    if (decision.kind === 'NOT_DUE') return 'NOT_DUE';
    if (decision.kind === 'RESCHEDULED') {
      await this.ports.claims.reschedule(tx, input.companyId, locked.id, decision.schedule, now);
      return 'RESCHEDULED';
    }
    return this.claim(
      tx,
      input.companyId,
      locked,
      customer,
      decision.performers,
      decision.schedule,
      now,
    );
  }

  private async claim(
    tx: Tx,
    companyId: string,
    request: DueRatingRequest,
    customer: { name: string; phone: string; locale: 'ar' | 'en' },
    performers: readonly string[],
    schedule: StoredClaimSchedule,
    now: Date,
  ): Promise<ClaimOutcome> {
    const token = this.ports.token.claim({ companyId, ratingRequestId: request.id });
    if (token === null) return 'TOKEN_UNAVAILABLE';
    const names = await this.ports.names.names(tx, companyId, request.businessId);
    if (names === null) throw new Error('RATING_BUSINESS_NOT_FOUND');
    const businessName =
      customer.locale === 'ar' ? (names.name_ar ?? names.name_en) : names.name_en;
    const label = await this.performersLabel(tx, companyId, performers, businessName, customer.locale);
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
        tokenKeyVersion: token.keyVersion,
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
    return 'CLAIMED';
  }

  private async performersLabel(
    tx: Tx,
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
    tx: Tx,
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
