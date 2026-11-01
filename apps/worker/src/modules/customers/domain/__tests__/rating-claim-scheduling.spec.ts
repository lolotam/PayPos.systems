import { describe, expect, it } from 'vitest';

import {
  FORWARD_VISITS,
  LEASE_MS,
  MAX_VISITS_PER_TURN,
  RENEWAL_INTERVAL_MS,
  RETRY_BACKOFF_MS,
  RETRY_CAPACITY,
  RETRY_VISITS,
  assertVisitBudget,
  isClaimable,
  leaseRenewalDue,
  nextRetryEligibility,
  rereadObservation,
  settleClaim,
  type ClaimableRequest,
  type ClaimObservation,
  type ClaimSettlement,
  type VisitBudget,
} from '../rating-claim-scheduling.ts';

const now = new Date('2026-11-01T08:00:00.000Z');

// الميزانية: المسار الأمامي ومسار الإعادة محجوزين مع بعض، ومجموعهم ما بيتعداش
// مئة زيارة في الدور الواحد، ومفيش مسار بيستعير من التاني.
describe('ميزانية الدور', () => {
  it('default_budget_is_accepted', () => {
    expect(assertVisitBudget({ forward: FORWARD_VISITS, retry: RETRY_VISITS })).toEqual({
      forward: 75,
      retry: 25,
    });
  });

  it('forward_and_retry_sum_to_the_visit_ceiling', () => {
    expect(FORWARD_VISITS + RETRY_VISITS).toBe(MAX_VISITS_PER_TURN);
  });

  it.each<[string, VisitBudget]>([
    ['forward_budget_must_be_positive_not_zero', { forward: 0, retry: RETRY_VISITS }],
    ['forward_budget_must_be_positive_not_negative', { forward: -1, retry: RETRY_VISITS }],
    ['forward_budget_must_be_a_whole_number', { forward: 1.5, retry: RETRY_VISITS }],
    ['retry_budget_must_be_positive_not_zero', { forward: FORWARD_VISITS, retry: 0 }],
    ['retry_budget_must_be_positive_not_negative', { forward: FORWARD_VISITS, retry: -3 }],
    ['retry_budget_must_be_a_whole_number', { forward: FORWARD_VISITS, retry: 2.5 }],
  ])('%s', (_scenario, budget) => {
    expect(() => assertVisitBudget(budget)).toThrow(RangeError);
  });

  it('total_budget_above_one_hundred_is_refused', () => {
    expect(() => assertVisitBudget({ forward: 76, retry: 25 })).toThrow(
      'VISIT_BUDGET_TOTAL_EXCEEDED',
    );
  });

  it('total_budget_of_exactly_one_hundred_is_accepted', () => {
    expect(assertVisitBudget({ forward: 75, retry: 25 })).toEqual({ forward: 75, retry: 25 });
  });

  it('retry_map_capacity_matches_the_design', () => {
    expect(RETRY_CAPACITY).toBe(2048);
  });
});

// التسوية: أي طلب فضل مجدول بعد ما اتحاول يفضل قابل لإعادة المحاولة، والنتيجة
// المجهولة عمر ما بتتحول لنهائية.
describe('تسوية مصير الطلب', () => {
  it.each<[string, ClaimObservation, ClaimSettlement]>([
    ['scheduled_after_attempt_is_retried', { kind: 'STATUS', status: 'SCHEDULED' }, 'RETRY'],
    ['sending_after_attempt_is_terminal', { kind: 'STATUS', status: 'SENDING' }, 'TERMINAL'],
    ['sent_after_attempt_is_terminal', { kind: 'STATUS', status: 'SENT' }, 'TERMINAL'],
    ['cancelled_after_attempt_is_terminal', { kind: 'STATUS', status: 'CANCELLED' }, 'TERMINAL'],
    ['committed_absence_is_absent', { kind: 'ABSENT' }, 'ABSENT'],
    ['future_row_was_not_attempted', { kind: 'FUTURE_UNATTEMPTED' }, 'FUTURE_UNATTEMPTED'],
    ['unknown_commit_is_retried', { kind: 'UNKNOWN' }, 'RETRY'],
  ])('%s', (_scenario, observation, settlement) => {
    expect(settleClaim(observation)).toBe(settlement);
  });

  it('unknown_commit_never_becomes_terminal', () => {
    const settlement = settleClaim({ kind: 'UNKNOWN' });
    expect(settlement).not.toBe('TERMINAL');
    expect(settlement).toBe('RETRY');
  });

  it('future_row_never_enters_the_retry_map', () => {
    expect(settleClaim({ kind: 'FUTURE_UNATTEMPTED' })).not.toBe('RETRY');
  });
});

// الاستحقاق: الأساس now + 60 ثانية، وموعد الاستحقاق المخزن يقدر يقدّم إعادة
// النظر بس ما يبعدهاش أكتر من السقف.
describe('وقت إعادة النظر', () => {
  it.each<[string, Date | null, number]>([
    ['no_stored_due_at_uses_the_full_backoff', null, RETRY_BACKOFF_MS],
    ['past_due_at_keeps_the_full_backoff', new Date(now.getTime() - 5_000), RETRY_BACKOFF_MS],
    ['near_future_due_at_pulls_the_retry_earlier', new Date(now.getTime() + 10_000), 10_000],
    [
      'far_future_due_at_never_defers_past_the_cap',
      new Date(now.getTime() + 10 * RETRY_BACKOFF_MS),
      RETRY_BACKOFF_MS,
    ],
  ])('%s', (_scenario, storedDueAt, offset) => {
    expect(nextRetryEligibility(now, storedDueAt).getTime()).toBe(now.getTime() + offset);
  });

  it('eligibility_never_precedes_the_current_moment', () => {
    const due = new Date(now.getTime() - 60_000);
    expect(nextRetryEligibility(now, due).getTime()).toBeGreaterThan(now.getTime());
  });
});

// الاستحقاق الآن: الطلب لازم يكون مجدولاً ومستحقاً، وإلا الجولة الحالية ما
// بتلمسهوش؛ وإعادة القراءة بتترجم الحالة إلى مشاهدة تسوية.
describe('استحقاق الطلب الآن', () => {
  it.each<[string, ClaimableRequest, boolean]>([
    ['scheduled_and_due_is_claimable', { status: 'SCHEDULED', dueAt: now }, true],
    [
      'scheduled_and_overdue_is_claimable',
      { status: 'SCHEDULED', dueAt: new Date(now.getTime() - 1_000) },
      true,
    ],
    [
      'scheduled_and_not_due_yet_is_not_claimable',
      { status: 'SCHEDULED', dueAt: new Date(now.getTime() + 1_000) },
      false,
    ],
    ['sending_is_not_claimable', { status: 'SENDING', dueAt: now }, false],
    ['sent_is_not_claimable', { status: 'SENT', dueAt: now }, false],
    ['cancelled_is_not_claimable', { status: 'CANCELLED', dueAt: now }, false],
  ])('%s', (_scenario, request, expected) => {
    expect(isClaimable(request, now)).toBe(expected);
  });

  it('the_reread_status_becomes_a_status_observation', () => {
    expect(rereadObservation('SENT')).toEqual({ kind: 'STATUS', status: 'SENT' });
  });

  it('the_reread_status_settles_through_the_same_rule', () => {
    expect(settleClaim(rereadObservation('SENT'))).toBe('TERMINAL');
    expect(settleClaim(rereadObservation('SCHEDULED'))).toBe('RETRY');
  });
});

// تجديد الحجز: ربع مدة الحجز بالظبط، والقرار بيتحسب بالساعة المحقونة.
describe('تجديد حجز المالك', () => {
  it('the_renewal_interval_is_a_quarter_of_the_lease', () => {
    expect(RENEWAL_INTERVAL_MS).toBe(LEASE_MS / 4);
    expect(RENEWAL_INTERVAL_MS).toBe(30_000);
  });

  it('a_lease_renewed_now_is_not_due_again', () => {
    expect(leaseRenewalDue(now, now)).toBe(false);
  });

  it('a_lease_is_due_for_renewal_after_the_interval', () => {
    expect(leaseRenewalDue(now, new Date(now.getTime() - RENEWAL_INTERVAL_MS))).toBe(true);
  });

  it('a_lease_before_the_interval_is_not_due', () => {
    expect(leaseRenewalDue(now, new Date(now.getTime() - RENEWAL_INTERVAL_MS + 1))).toBe(false);
  });
});
