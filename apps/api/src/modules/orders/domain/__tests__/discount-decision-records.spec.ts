import { describe, expect, it } from 'vitest';
import {
  discountApprovedByPerformerEvent,
  discountDecisionAudits,
  discountDecisionResponse,
  type DiscountDecisionChannel,
  type DiscountDecisionEventContext,
} from '../discount-decision-records.ts';
import type {
  DiscountDecisionPlan,
  DiscountProposalDecision,
  LockedDiscountProposal,
} from '../discount-decision-plan.ts';

const NOW = new Date('2026-10-15T10:00:00.000Z');
const EXPIRES_AT = new Date('2026-10-16T10:00:00.000Z');

const REMOTE_CHANNEL: DiscountDecisionChannel = { decided_via: 'REMOTE', decided_device_id: null };

const EVENT_CONTEXT: DiscountDecisionEventContext = {
  ...REMOTE_CHANNEL,
  business_id: 'biz-1',
  branch_id: 'branch-1',
  decider_label_ar: 'ليلى (مديرة فرع)',
  decider_label_en: 'Layla (Branch Manager)',
};

/** يصنع عينة صف مقفول للاختبار. */
function sampleLocked(id: string, over: Partial<LockedDiscountProposal> = {}): LockedDiscountProposal {
  return {
    id,
    status: 'PENDING',
    expires_at: EXPIRES_AT,
    terms_hash: 'a'.repeat(64),
    effective_bps: 2000,
    requested_by: 'requester-1',
    service_id: `svc-${id}`,
    service_name_en: `Service ${id}`,
    service_name_ar: `خدمة ${id}`,
    occurred_at: NOW,
    performers: [],
    ...over,
  };
}

/** يصنع عينة قرار اقتراح مفرد. */
function sampleDecision(id: string, over: Partial<DiscountProposalDecision> = {}): DiscountProposalDecision {
  return {
    id,
    status: 'APPROVED',
    expires_at: EXPIRES_AT,
    approver_is_performer: false,
    approved_limit_source: 'PERSON',
    approved_limit_bps: 2000,
    reject_reason: null,
    ...over,
  };
}

describe('discountDecisionAudits', () => {
  it('creates one audit entry per approved proposal with limit and performer flag and without sensitive data', () => {
    const plan: DiscountDecisionPlan = {
      decision: 'APPROVE',
      decided_by: 'user-approver',
      decided_by_membership_id: 'mem-approver',
      decided_at: NOW,
      has_performer_flag: true,
      proposals: [
        sampleDecision('prop-1', { approver_is_performer: true, approved_limit_source: 'PERSON', approved_limit_bps: 2000 }),
        sampleDecision('prop-2', { approver_is_performer: false, approved_limit_source: 'PERSON', approved_limit_bps: 2000 }),
      ],
    };
    const audits = discountDecisionAudits(plan, REMOTE_CHANNEL);
    expect(audits).toHaveLength(2);
    expect(audits[0]).toEqual({
      entity: 'discount_proposal',
      entityId: 'prop-1',
      action: 'discount_proposal.approved',
      after: {
        status: 'APPROVED',
        decided_by: 'user-approver',
        decided_by_membership_id: 'mem-approver',
        decided_via: 'REMOTE',
        decided_device_id: null,
        decided_at: NOW.toISOString(),
        approved_limit_source: 'PERSON',
        approved_limit_bps: 2000,
        approver_is_performer: true,
      },
    });
  });

  it('creates one audit entry per rejected proposal without reason text or limit fields', () => {
    const plan: DiscountDecisionPlan = {
      decision: 'REJECT',
      decided_by: 'user-approver',
      decided_by_membership_id: 'mem-approver',
      decided_at: NOW,
      has_performer_flag: false,
      proposals: [
        sampleDecision('prop-1', { status: 'REJECTED', reject_reason: 'الخصم غير مناسب' }),
      ],
    };
    const audits = discountDecisionAudits(plan, REMOTE_CHANNEL);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toEqual({
      entity: 'discount_proposal',
      entityId: 'prop-1',
      action: 'discount_proposal.rejected',
      after: {
        status: 'REJECTED',
        decided_by: 'user-approver',
        decided_by_membership_id: 'mem-approver',
        decided_via: 'REMOTE',
        decided_device_id: null,
        decided_at: NOW.toISOString(),
      },
    });
  });
});

describe('discountApprovedByPerformerEvent', () => {
  it('returns null when decision is REJECT', () => {
    const plan: DiscountDecisionPlan = {
      decision: 'REJECT',
      decided_by: 'user-approver',
      decided_by_membership_id: 'mem-approver',
      decided_at: NOW,
      has_performer_flag: true,
      proposals: [sampleDecision('prop-1', { status: 'REJECTED' })],
    };
    expect(discountApprovedByPerformerEvent(plan, [sampleLocked('prop-1')], EVENT_CONTEXT)).toBeNull();
  });

  it('returns null when decision is APPROVE but has_performer_flag is false', () => {
    const plan: DiscountDecisionPlan = {
      decision: 'APPROVE',
      decided_by: 'user-approver',
      decided_by_membership_id: 'mem-approver',
      decided_at: NOW,
      has_performer_flag: false,
      proposals: [sampleDecision('prop-1', { approver_is_performer: false })],
    };
    expect(discountApprovedByPerformerEvent(plan, [sampleLocked('prop-1')], EVENT_CONTEXT)).toBeNull();
  });

  it('returns event payload containing only flagged proposals when has_performer_flag is true', () => {
    const plan: DiscountDecisionPlan = {
      decision: 'APPROVE',
      decided_by: 'user-approver',
      decided_by_membership_id: 'mem-approver',
      decided_at: NOW,
      has_performer_flag: true,
      proposals: [
        sampleDecision('prop-1', { approver_is_performer: true }),
        sampleDecision('prop-2', { approver_is_performer: false }),
      ],
    };
    const locked = [sampleLocked('prop-1'), sampleLocked('prop-2')];
    const event = discountApprovedByPerformerEvent(plan, locked, EVENT_CONTEXT);
    expect(event).toEqual({
      schema_version: 1,
      business_id: 'biz-1',
      branch_id: 'branch-1',
      decided_by: 'user-approver',
      decider_label_en: 'Layla (Branch Manager)',
      decider_label_ar: 'ليلى (مديرة فرع)',
      decided_via: 'REMOTE',
      proposals: [
        {
          id: 'prop-1',
          service_id: 'svc-prop-1',
          name_en: 'Service prop-1',
          name_ar: 'خدمة prop-1',
          effective_bps: 2000,
        },
      ],
    });
  });
});

describe('discountDecisionResponse', () => {
  it('returns proposals in same order with status and unchanged ISO expires_at', () => {
    const plan: DiscountDecisionPlan = {
      decision: 'APPROVE',
      decided_by: 'user-approver',
      decided_by_membership_id: 'mem-approver',
      decided_at: NOW,
      has_performer_flag: false,
      proposals: [
        sampleDecision('prop-1', { status: 'APPROVED', expires_at: EXPIRES_AT }),
        sampleDecision('prop-2', { status: 'APPROVED', expires_at: EXPIRES_AT }),
      ],
    };
    const response = discountDecisionResponse(plan);
    expect(response).toEqual({
      proposals: [
        { id: 'prop-1', status: 'APPROVED', expires_at: EXPIRES_AT.toISOString() },
        { id: 'prop-2', status: 'APPROVED', expires_at: EXPIRES_AT.toISOString() },
      ],
    });
  });
});
