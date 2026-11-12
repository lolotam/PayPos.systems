import { describe, expect, it } from 'vitest';
import {
  planDiscountDecision,
  planDiscountStatus,
  type DiscountDecisionInput,
  type DiscountDecisionProposal,
  type LockedDiscountProposal,
} from '../discount-decision-plan.ts';
import type { SessionLimit } from '../session-types.ts';

const NOW = new Date('2026-10-15T10:00:00.000Z');
const FUTURE = new Date('2026-10-15T12:00:00.000Z');
const HASH = 'a'.repeat(64);
const MANAGER_LIMIT: SessionLimit = { source: 'PERSON', bps: 2000 };

/** يبني اقتراحاً مقفولاً مع إمكانية تعديل أي حقل للاختبار. */
function sampleLocked(over: Partial<LockedDiscountProposal> = {}): LockedDiscountProposal {
  return {
    id: 'prop-1',
    status: 'PENDING',
    expires_at: FUTURE,
    terms_hash: HASH,
    effective_bps: 2000,
    requested_by: 'user-requester',
    service_id: 'service-1',
    service_name_en: 'Hair Cut',
    service_name_ar: 'قص شعر',
    occurred_at: new Date('2026-10-14T08:00:00.000Z'),
    performers: [{ employee_id: 'emp-1', snapshot_user_id: 'user-performer' }],
    ...over,
  };
}

/** يبني مدخل قرار لاقتراح واحد بعد دمج لقطة المنفّذين بروابطهم. */
function sampleProposal(over: Partial<DiscountDecisionProposal> = {}): DiscountDecisionProposal {
  return {
    id: 'prop-1',
    status: 'PENDING',
    expires_at: FUTURE,
    effective_bps: 2000,
    requested_by: 'user-requester',
    service_id: 'service-1',
    service_name_en: 'Hair Cut',
    service_name_ar: 'قص شعر',
    occurred_at: new Date('2026-10-14T08:00:00.000Z'),
    performers: [{ snapshot_user_id: 'user-performer', current_user_id: null }],
    ...over,
  };
}

/** مساعد يبني خطة موافقة مع قيم افتراضية كاملة. */
function approveInput(over: Partial<DiscountDecisionInput> = {}): DiscountDecisionInput {
  return {
    decision: 'APPROVE',
    user_id: 'user-manager',
    membership_id: 'mem-1',
    now: NOW,
    limit: MANAGER_LIMIT,
    proposals: [sampleProposal()],
    ...over,
  } as DiscountDecisionInput;
}

/** مساعد يبني خطة رفض مع قيم افتراضية كاملة. */
function rejectInput(over: Partial<DiscountDecisionInput> = {}): DiscountDecisionInput {
  return {
    decision: 'REJECT',
    user_id: 'user-manager',
    membership_id: 'mem-1',
    now: NOW,
    proposals: [sampleProposal()],
    ...over,
  } as DiscountDecisionInput;
}

describe('planDiscountStatus', () => {
  it('passes when proposal is live PENDING and terms hash matches case-insensitively', () => {
    expect(() => {
      planDiscountStatus([sampleLocked({ terms_hash: HASH.toUpperCase() })], [HASH.toLowerCase()], NOW);
    }).not.toThrow();
  });

  const INVALID_STATUS_CASES: [string, Partial<LockedDiscountProposal>][] = [
    ['expires exactly at now', { expires_at: NOW }],
    ['expired before now', { expires_at: new Date(NOW.getTime() - 1000) }],
    ['already approved', { status: 'APPROVED' }],
    ['already rejected', { status: 'REJECTED' }],
    ['already consumed', { status: 'CONSUMED' }],
  ];

  it.each(INVALID_STATUS_CASES)('throws DISCOUNT_PROPOSAL_NOT_PENDING when proposal is %s', (_label, over) => {
    expect(() => {
      planDiscountStatus([sampleLocked(over)], [HASH], NOW);
    }).toThrowError(expect.objectContaining({
      code: 'DISCOUNT_PROPOSAL_NOT_PENDING',
      details: { proposal_id: 'prop-1' },
    }));
  });

  it('throws DISCOUNT_PROPOSAL_CHANGED when stored hash differs from expected hash', () => {
    expect(() => {
      planDiscountStatus([sampleLocked({ terms_hash: HASH })], ['b'.repeat(64)], NOW);
    }).toThrowError(expect.objectContaining({
      code: 'DISCOUNT_PROPOSAL_CHANGED',
      details: { proposal_id: 'prop-1' },
    }));
  });

  it('throws DISCOUNT_PROPOSAL_CHANGED when expected hash is missing', () => {
    expect(() => {
      planDiscountStatus([sampleLocked()], [], NOW);
    }).toThrowError(expect.objectContaining({
      code: 'DISCOUNT_PROPOSAL_CHANGED',
      details: { proposal_id: 'prop-1' },
    }));
  });

  it('all-or-nothing: throws on first failing proposal in batch with its proposal id', () => {
    const p1 = sampleLocked({ id: 'prop-1' });
    const p2 = sampleLocked({ id: 'prop-2', status: 'CONSUMED' });
    expect(() => {
      planDiscountStatus([p1, p2], [HASH, HASH], NOW);
    }).toThrowError(expect.objectContaining({
      code: 'DISCOUNT_PROPOSAL_NOT_PENDING',
      details: { proposal_id: 'prop-2' },
    }));
  });
});

describe('planDiscountDecision - approve limits', () => {
  it('approves when effective_bps equals approver limit_bps (inclusive limit)', () => {
    const plan = planDiscountDecision(approveInput({ proposals: [sampleProposal({ effective_bps: 2000 })] }));
    expect(plan.decision).toBe('APPROVE');
    expect(plan.proposals[0]?.status).toBe('APPROVED');
    expect(plan.proposals[0]?.approved_limit_source).toBe('PERSON');
    expect(plan.proposals[0]?.approved_limit_bps).toBe(2000);
    expect(plan.proposals[0]?.reject_reason).toBeNull();
  });

  it('approves when effective_bps is below approver limit_bps', () => {
    const plan = planDiscountDecision(approveInput({ proposals: [sampleProposal({ effective_bps: 1500 })] }));
    expect(plan.proposals[0]?.status).toBe('APPROVED');
  });

  it('throws DISCOUNT_APPROVER_LIMIT_TOO_LOW when effective_bps exceeds limit by 1', () => {
    expect(() => {
      planDiscountDecision(approveInput({ proposals: [sampleProposal({ id: 'prop-high', effective_bps: 2001 })] }));
    }).toThrowError(expect.objectContaining({
      code: 'DISCOUNT_APPROVER_LIMIT_TOO_LOW',
      details: { proposal_id: 'prop-high', limit_bps: 2000, effective_bps: 2001 },
    }));
  });

  it('passes for OWNER limit source regardless of effective_bps', () => {
    const plan = planDiscountDecision(approveInput({
      user_id: 'user-owner',
      limit: { source: 'OWNER', bps: null },
      proposals: [sampleProposal({ effective_bps: 10000 })],
    }));
    expect(plan.proposals[0]?.status).toBe('APPROVED');
    expect(plan.proposals[0]?.approved_limit_source).toBe('OWNER');
    expect(plan.proposals[0]?.approved_limit_bps).toBeNull();
  });

  it('fails for NOT_CONFIGURED limit source when effective_bps > 0', () => {
    expect(() => {
      planDiscountDecision(approveInput({
        limit: { source: 'NOT_CONFIGURED', bps: 0 },
        proposals: [sampleProposal({ id: 'prop-1', effective_bps: 1 })],
      }));
    }).toThrowError(expect.objectContaining({
      code: 'DISCOUNT_APPROVER_LIMIT_TOO_LOW',
      details: { proposal_id: 'prop-1', limit_bps: 0, effective_bps: 1 },
    }));
  });

});

describe('planDiscountDecision - approve requester, performer and batch', () => {
  it('throws DISCOUNT_APPROVER_IS_REQUESTER when approver is requester case-insensitively', () => {
    expect(() => {
      planDiscountDecision(approveInput({
        user_id: 'USER-REQUESTER',
        limit: { source: 'OWNER', bps: null },
        proposals: [sampleProposal({ id: 'prop-self', requested_by: 'user-requester' })],
      }));
    }).toThrowError(expect.objectContaining({
      code: 'DISCOUNT_APPROVER_IS_REQUESTER',
      details: { proposal_id: 'prop-self' },
    }));
  });

  it('flags approver_is_performer true from request-time snapshot only', () => {
    const plan = planDiscountDecision(approveInput({
      user_id: 'user-snapshot',
      proposals: [sampleProposal({ performers: [{ snapshot_user_id: 'user-snapshot', current_user_id: null }] })],
    }));
    expect(plan.has_performer_flag).toBe(true);
    expect(plan.proposals[0]?.approver_is_performer).toBe(true);
  });

  it('flags approver_is_performer true from current link only', () => {
    const plan = planDiscountDecision(approveInput({
      user_id: 'user-current',
      proposals: [sampleProposal({ performers: [{ snapshot_user_id: 'user-other', current_user_id: 'user-current' }] })],
    }));
    expect(plan.has_performer_flag).toBe(true);
    expect(plan.proposals[0]?.approver_is_performer).toBe(true);
  });

  it('flags approver_is_performer false when approver is neither in snapshot nor current link', () => {
    const plan = planDiscountDecision(approveInput({
      user_id: 'user-outsider',
      proposals: [sampleProposal({ performers: [{ snapshot_user_id: 'user-a', current_user_id: 'user-b' }] })],
    }));
    expect(plan.has_performer_flag).toBe(false);
    expect(plan.proposals[0]?.approver_is_performer).toBe(false);
  });

  it('all-or-nothing: failure on second proposal stops execution and throws with its id', () => {
    const p1 = sampleProposal({ id: 'prop-1', effective_bps: 1000 });
    const p2 = sampleProposal({ id: 'prop-2', effective_bps: 3000 });
    expect(() => {
      planDiscountDecision(approveInput({ proposals: [p1, p2] }));
    }).toThrowError(expect.objectContaining({
      code: 'DISCOUNT_APPROVER_LIMIT_TOO_LOW',
      details: { proposal_id: 'prop-2', limit_bps: 2000, effective_bps: 3000 },
    }));
  });
});

describe('planDiscountDecision - reject', () => {
  it('reject succeeds with undefined reason and sets approver_is_performer and limit fields to null', () => {
    const plan = planDiscountDecision(rejectInput({
      user_id: 'user-requester',
      proposals: [sampleProposal({ requested_by: 'user-requester' })],
    }));
    expect(plan.decision).toBe('REJECT');
    expect(plan.has_performer_flag).toBe(false);
    expect(plan.proposals[0]?.status).toBe('REJECTED');
    expect(plan.proposals[0]?.reject_reason).toBeNull();
    expect(plan.proposals[0]?.approver_is_performer).toBeNull();
    expect(plan.proposals[0]?.approved_limit_source).toBeNull();
    expect(plan.proposals[0]?.approved_limit_bps).toBeNull();
  });

  it('reject trims leading and trailing whitespace, tabs, and newlines', () => {
    const plan = planDiscountDecision(rejectInput({ reason: ' \t\r\nالخصم كبير جداً \n\t ' }));
    expect(plan.proposals[0]?.reject_reason).toBe('الخصم كبير جداً');
  });

  it('counts Arabic text and astral emojis as single code points and accepts up to 500 code points', () => {
    const reason = 'خصم غير مسموح ✂️';
    const plan = planDiscountDecision(rejectInput({ reason }));
    expect(plan.proposals[0]?.reject_reason).toBe(reason);

    const emoji500 = '😀'.repeat(500);
    const planEmoji = planDiscountDecision(rejectInput({ reason: emoji500 }));
    expect(planEmoji.proposals[0]?.reject_reason).toBe(emoji500);
  });

  it('throws DISCOUNT_REJECT_REASON_INVALID when reason exceeds 500 code points including astral emojis', () => {
    expect(() => {
      planDiscountDecision(rejectInput({ reason: '😀'.repeat(501) }));
    }).toThrowError(expect.objectContaining({
      code: 'DISCOUNT_REJECT_REASON_INVALID',
    }));
  });

  it('throws DISCOUNT_REJECT_REASON_INVALID when reason is empty after trimming', () => {
    expect(() => {
      planDiscountDecision(rejectInput({ reason: '   \t\n\r  ' }));
    }).toThrowError(expect.objectContaining({
      code: 'DISCOUNT_REJECT_REASON_INVALID',
    }));
  });

  it.each([
    ['NBSP', '\u00A0'],
    ['VT/FF', '\u000B\u000C'],
    ['ideographic space', '\u3000'],
  ])('throws DISCOUNT_REJECT_REASON_INVALID for a %s-only reason', (_label, reason) => {
    expect(() => {
      planDiscountDecision(rejectInput({ reason }));
    }).toThrowError(expect.objectContaining({
      code: 'DISCOUNT_REJECT_REASON_INVALID',
    }));
  });

  it('keeps inner Unicode whitespace while trimming the reason edges', () => {
    const plan = planDiscountDecision(rejectInput({ reason: '\u00A0سبب\u3000مرفوض\u00A0' }));
    expect(plan.proposals[0]?.reject_reason).toBe('سبب\u3000مرفوض');
  });
});
