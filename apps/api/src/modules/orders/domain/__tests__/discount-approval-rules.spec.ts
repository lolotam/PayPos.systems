import { describe, expect, it } from 'vitest';
import {
  DISCOUNT_APPROVAL_VALIDITY_MS,
  approverIsPerformer,
  canApprove,
  consumptionRefusal,
  needsApproval,
  proposalExpiry,
  proposalState,
  type ConsumableProposal,
  type ConsumptionActor,
  type DiscountProposalStatus,
  type ProposalPerformerLink,
} from '../discount-approval-rules.ts';
import { buildDiscountTerms, discountTermsHash, type DiscountTermsInput, type DiscountTermsV1 } from '../discount-terms.ts';
import type { SessionLimit } from '../session-types.ts';

const identityHasher = (text: string): string => text;

const INPUT: DiscountTermsInput = {
  company_id: 'company-1',
  business_id: 'business-1',
  branch_id: 'branch-1',
  customer_id: 'customer-1',
  session_id: 'session-1',
  service_id: 'service-1',
  requested_by: 'user-1',
  requested_by_membership_id: 'membership-1',
  occurred_business_date: '2026-10-21',
  list_price: 25000n,
  price: 25000n,
  discount: 5000n,
  performer_ids: ['employee-1', 'employee-2'],
};

const TERMS = buildDiscountTerms(INPUT);
const NOW = new Date('2026-10-21T12:00:00.000Z');
const EXPIRY = new Date('2026-10-22T12:00:00.000Z');
const BEFORE = new Date('2026-10-22T11:59:59.999Z');
const AFTER = new Date('2026-10-22T12:00:00.001Z');
const ACTOR: ConsumptionActor = { branch_id: 'branch-1', user_id: 'user-1', membership_id: 'membership-1' };

function proposal(over: Partial<ConsumableProposal> = {}): ConsumableProposal {
  return {
    branch_id: 'branch-1',
    requested_by: 'user-1',
    requested_by_membership_id: 'membership-1',
    status: 'APPROVED',
    expires_at: EXPIRY,
    terms_hash: discountTermsHash(TERMS, identityHasher),
    ...over,
  };
}

const APPROVAL_CASES: [string, SessionLimit, number, boolean][] = [
  ['the owner needs no approval', { source: 'OWNER', bps: null }, 10000, false],
  ['a person at her own limit needs none', { source: 'PERSON', bps: 1000 }, 1000, false],
  ['a person one bps above her limit needs one', { source: 'PERSON', bps: 1000 }, 1001, true],
  ['a business at its own limit needs none', { source: 'BUSINESS', bps: 2000 }, 2000, false],
  ['a business one bps above its limit needs one', { source: 'BUSINESS', bps: 2000 }, 2001, true],
  ['no configured limit and no discount needs none', { source: 'NOT_CONFIGURED', bps: 0 }, 0, false],
  ['no configured limit and a discount needs one', { source: 'NOT_CONFIGURED', bps: 0 }, 1, true],
];

const APPROVE_CASES: [string, SessionLimit, number, boolean][] = [
  ['the owner covers any discount', { source: 'OWNER', bps: null }, 10000, true],
  ['a person at her own limit covers it', { source: 'PERSON', bps: 2000 }, 2000, true],
  ['a person below her own limit covers it', { source: 'PERSON', bps: 2000 }, 1999, true],
  ['a person one bps above her limit does not', { source: 'PERSON', bps: 2000 }, 2001, false],
  ['a business at its own limit covers it', { source: 'BUSINESS', bps: 1500 }, 1500, true],
  ['a business above its own limit does not', { source: 'BUSINESS', bps: 1500 }, 1501, false],
  ['no configured limit covers a discount of nothing', { source: 'NOT_CONFIGURED', bps: 0 }, 0, true],
  ['no configured limit covers no discount at all', { source: 'NOT_CONFIGURED', bps: 0 }, 1, false],
];

const PERFORMER_CASES: [string, string, ProposalPerformerLink[], boolean][] = [
  ['the request-time snapshot', 'u1', [{ snapshot_user_id: 'u1', current_user_id: 'u2' }], true],
  ['the current link', 'u2', [{ snapshot_user_id: 'u1', current_user_id: 'u2' }], true],
  ['a performer relinked after the request', 'u1', [{ snapshot_user_id: 'u1', current_user_id: 'u3' }], true],
  ['a performer unlinked after the request', 'u1', [{ snapshot_user_id: 'u1', current_user_id: null }], true],
  ['a performer linked only after the request', 'u1', [{ snapshot_user_id: null, current_user_id: 'u1' }], true],
  ['the second of several performers', 'u2', [{ snapshot_user_id: 'u1', current_user_id: null }, { snapshot_user_id: null, current_user_id: 'u2' }], true],
  ['nobody', 'u1', [{ snapshot_user_id: 'u2', current_user_id: 'u3' }], false],
  ['an empty performer list', 'u1', [], false],
  ['a performer without any link', 'u1', [{ snapshot_user_id: null, current_user_id: null }], false],
  ['a mixed-case approver id', 'U1', [{ snapshot_user_id: 'u1', current_user_id: null }], true],
  ['a mixed-case snapshot id', 'u1', [{ snapshot_user_id: 'U1', current_user_id: null }], true],
];

const CHANGED_FIELDS: [string, unknown][] = [
  ['list_price', '25.001'],
  ['price', '24.000'],
  ['discount', '5.500'],
  ['net', '19.500'],
  ['service_id', 'service-2'],
  ['customer_id', 'customer-2'],
  ['performer_ids', ['employee-3']],
  ['branch_id', 'branch-2'],
  ['occurred_business_date', '2026-10-22'],
  ['session_id', 'session-2'],
];

// The local clock in a zone that changed its offset that night, so the wall clock is not simply +24h.
const localHourIn = (timeZone: string, instant: Date): string =>
  new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(instant);

describe('the expiry of an approval', () => {
  it('lasts twenty-four hours from the request', () => {
    expect(DISCOUNT_APPROVAL_VALIDITY_MS).toBe(86_400_000);
    expect(proposalExpiry(new Date('2026-10-21T12:00:00.000Z')).toISOString()).toBe(
      '2026-10-22T12:00:00.000Z',
    );
  });

  it('does not mutate the request time it was given', () => {
    const requestedAt = new Date('2026-10-21T12:00:00.000Z');
    const expiry = proposalExpiry(requestedAt);
    expect(requestedAt.toISOString()).toBe('2026-10-21T12:00:00.000Z');
    expect(expiry).not.toBe(requestedAt);
  });

  it('crosses a month end and a year end in UTC', () => {
    expect(proposalExpiry(new Date('2026-10-31T23:30:00.000Z')).toISOString()).toBe(
      '2026-11-01T23:30:00.000Z',
    );
    expect(proposalExpiry(new Date('2026-12-31T12:00:00.000Z')).toISOString()).toBe(
      '2027-01-01T12:00:00.000Z',
    );
  });

  it('adds exactly 86,400,000 ms across a daylight-saving date in a DST zone', () => {
    const requestedAt = new Date('2026-11-01T05:30:00.000Z');
    const expiry = proposalExpiry(requestedAt);
    expect(expiry.getTime() - requestedAt.getTime()).toBe(DISCOUNT_APPROVAL_VALIDITY_MS);
    expect(localHourIn('America/New_York', expiry)).not.toBe(
      localHourIn('America/New_York', requestedAt),
    );
  });

  it('approval does not move the expiry: proposalExpiry takes only the request time', () => {
    expect(proposalExpiry.length).toBe(1);
    const requestedAt = new Date('2026-10-21T12:00:00.000Z');
    expect(proposalExpiry(requestedAt).getTime()).toBe(
      proposalExpiry(new Date(requestedAt.getTime())).getTime(),
    );
  });

  it('reads a row made with that expiry as PENDING just before it and EXPIRED at it', () => {
    const requestedAt = new Date('2026-10-21T12:00:00.000Z');
    const expiresAt = proposalExpiry(requestedAt);
    expect(proposalState('PENDING', expiresAt, new Date(expiresAt.getTime() - 1))).toBe('PENDING');
    expect(proposalState('PENDING', expiresAt, expiresAt)).toBe('EXPIRED');
  });
});

describe('when a discount needs an approval', () => {
  it.each(APPROVAL_CASES)('%s', (_label, limit, effectiveBps, expected) => {
    expect(needsApproval(limit, effectiveBps)).toBe(expected);
  });
});

describe('the state of a request as it is read', () => {
  it.each(['PENDING', 'APPROVED', 'REJECTED', 'CONSUMED'] as DiscountProposalStatus[])(
    'reads %s before its expiry as itself',
    (status) => {
      expect(proposalState(status, EXPIRY, BEFORE)).toBe(status);
    },
  );

  it.each(['PENDING', 'APPROVED'] as DiscountProposalStatus[])(
    'reads %s at its expiry as expired',
    (status) => {
      expect(proposalState(status, EXPIRY, EXPIRY)).toBe('EXPIRED');
    },
  );

  it.each(['PENDING', 'APPROVED'] as DiscountProposalStatus[])(
    'reads %s after its expiry as expired',
    (status) => {
      expect(proposalState(status, EXPIRY, AFTER)).toBe('EXPIRED');
    },
  );

  it.each(['REJECTED', 'CONSUMED'] as DiscountProposalStatus[])(
    'keeps %s after its expiry',
    (status) => {
      expect(proposalState(status, EXPIRY, AFTER)).toBe(status);
    },
  );
});

describe('how much an approver may cover', () => {
  it.each(APPROVE_CASES)('%s', (_label, limit, effectiveBps, expected) => {
    expect(canApprove(limit, { effective_bps: effectiveBps })).toBe(expected);
  });
});

describe('whether the approver performed the line', () => {
  it.each(PERFORMER_CASES)('%s', (_label, approverUserId, performers, expected) => {
    expect(approverIsPerformer(approverUserId, performers)).toBe(expected);
  });
});

describe('whether a line may consume an approval', () => {
  it('refuses an unknown request, another branch, another requester and another membership alike', () => {
    expect(consumptionRefusal(null, TERMS, ACTOR, NOW, identityHasher)).toBe('NOT_FOUND');
    expect(consumptionRefusal(proposal({ branch_id: 'branch-2' }), TERMS, ACTOR, NOW, identityHasher)).toBe('NOT_FOUND');
    expect(consumptionRefusal(proposal({ requested_by: 'user-2' }), TERMS, ACTOR, NOW, identityHasher)).toBe('NOT_FOUND');
    expect(consumptionRefusal(proposal({ requested_by_membership_id: 'membership-2' }), TERMS, ACTOR, NOW, identityHasher)).toBe('NOT_FOUND');
  });

  it('accepts a request whose ids differ only by letter case', () => {
    const upper = proposal({
      branch_id: 'BRANCH-1',
      requested_by: 'USER-1',
      requested_by_membership_id: 'MEMBERSHIP-1',
    });
    expect(consumptionRefusal(upper, TERMS, ACTOR, NOW, identityHasher)).toBeNull();
  });

  it('refuses a request that is still pending or that was rejected', () => {
    expect(consumptionRefusal(proposal({ status: 'PENDING' }), TERMS, ACTOR, NOW, identityHasher)).toBe('NOT_APPROVED');
    expect(consumptionRefusal(proposal({ status: 'REJECTED' }), TERMS, ACTOR, NOW, identityHasher)).toBe('NOT_APPROVED');
  });

  it('refuses a request at or past its expiry, pending or approved', () => {
    expect(consumptionRefusal(proposal({ status: 'PENDING' }), TERMS, ACTOR, EXPIRY, identityHasher)).toBe('EXPIRED');
    expect(consumptionRefusal(proposal(), TERMS, ACTOR, AFTER, identityHasher)).toBe('EXPIRED');
  });

  it('refuses a consumed request, even after its expiry', () => {
    expect(consumptionRefusal(proposal({ status: 'CONSUMED' }), TERMS, ACTOR, NOW, identityHasher)).toBe('CONSUMED');
    expect(consumptionRefusal(proposal({ status: 'CONSUMED' }), TERMS, ACTOR, AFTER, identityHasher)).toBe('CONSUMED');
  });

  it.each(CHANGED_FIELDS)('refuses a line whose %s changed', (field, value) => {
    const changed = { ...TERMS, [field]: value } as unknown as DiscountTermsV1;
    expect(consumptionRefusal(proposal(), changed, ACTOR, NOW, identityHasher)).toBe('TERMS_MISMATCH');
  });

  it('accepts identical terms, whatever order the performers came in', () => {
    expect(consumptionRefusal(proposal(), TERMS, ACTOR, NOW, identityHasher)).toBeNull();
    const reordered = buildDiscountTerms({ ...INPUT, performer_ids: ['employee-2', 'employee-1'] });
    expect(consumptionRefusal(proposal(), reordered, ACTOR, NOW, identityHasher)).toBeNull();
  });
});
