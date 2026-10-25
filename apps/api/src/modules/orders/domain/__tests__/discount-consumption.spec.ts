import { expect, it } from 'vitest';
import { approvalClaims, decideApprovals, discountConsumptionAudits, type LockedProposal } from '../discount-consumption.ts';
import { discountTermsHash, type DiscountTermsV1 } from '../discount-terms.ts';
import { discountTermsOfLine, type DiscountTermsFacts } from '../discount-request.ts';
import { planSessionWrite, recordedSessionLine } from '../session-write.ts';
import { sessionLineSnapshot } from '../session-snapshot.ts';
import type { PreparedSessionLine, SessionEmployee, SessionLimit, SessionService } from '../session-types.ts';

const employee: SessionEmployee = { id: 'employee-1', name_en: 'Synthetic', name_ar: null, user_id: null, eligible: true, clocked_in: false, approved_leave: false };
const service: SessionService = { id: 'service-1', name_en: 'Synthetic', name_ar: null, price: 25000n, rule: { kind: 'FOLLOW_PLAN' }, counts: true, revision: 2 };
const messages = { message_ar: 'synthetic-ar', message_en: 'synthetic-en' };
const limit: SessionLimit = { source: 'PERSON', bps: 1000 };
const now = new Date('2026-10-21T12:00:00.000Z');
const expiry = new Date('2026-10-22T12:00:00.000Z');
const facts: DiscountTermsFacts = {
  company_id: 'company-1', business_id: 'business-1', branch_id: 'branch-1', customer_id: 'customer-1',
  session_id: null, requested_by: 'user-1', requested_by_membership_id: 'membership-1', occurred_business_date: '2026-10-21',
};
const actor = { branch_id: 'branch-1', user_id: 'user-1', membership_id: 'membership-1' };
const sha = (text: string) => text;
const termsOf = (line: PreparedSessionLine) => discountTermsOfLine(facts, line);
const hashOf = (line: PreparedSessionLine) => discountTermsHash(termsOf(line), sha);

function line(over: Partial<PreparedSessionLine> = {}): PreparedSessionLine {
  return {
    input_index: 0, service, price: 25000n, discount: 5000n, net: 20000n, effective_discount_bps: 2000,
    performers: [{ employee, share_bps: 10000, not_clocked_in_warning: false, approved_leave_warning: false }],
    has_performer_warning: false, explicit_unequal_shares: false, ...over,
  };
}

function proposal(over: Partial<LockedProposal> = {}): LockedProposal {
  return {
    id: 'proposal-1', branch_id: 'branch-1', requested_by: 'user-1', requested_by_membership_id: 'membership-1',
    status: 'APPROVED', expires_at: expiry, terms_hash: hashOf(line()), ...over,
  };
}

function decide(claims: ReturnType<typeof approvalClaims>, proposals: LockedProposal[], factsOf = facts) {
  return decideApprovals(claims, (item) => discountTermsOfLine(factsOf, item), proposals, actor, now, sha);
}

function onlyItem<T>(items: readonly T[]): T {
  const item = items[0];
  if (item === undefined) throw new Error('The list is empty');
  return item;
}

it('only a line above the limit that names an approval claims it', () => {
  const above = line({ approval_proposal_id: 'proposal-1' });
  expect(approvalClaims([above], limit)).toEqual([{ input_index: 0, proposal_id: 'proposal-1', line: above }]);
  expect(approvalClaims([line({ effective_discount_bps: 1000, approval_proposal_id: 'proposal-1' })], limit)).toEqual([]);
  expect(approvalClaims([line({ approval_proposal_id: 'proposal-1' })], { source: 'OWNER', bps: null })).toEqual([]);
  expect(approvalClaims([line()], limit)).toEqual([]);
  expect(approvalClaims([line({ effective_discount_bps: 1001, approval_proposal_id: 'proposal-1' })], limit)).toHaveLength(1);
});

it('the claims keep the input order of the request', () => {
  const first = line({ input_index: 0, approval_proposal_id: 'proposal-1' });
  const second = line({ input_index: 1, approval_proposal_id: 'proposal-2' });
  const third = line({ input_index: 2, approval_proposal_id: 'proposal-3' });
  expect(approvalClaims([first, second, third], limit).map((claim) => claim.proposal_id)).toEqual(['proposal-1', 'proposal-2', 'proposal-3']);
});

it('an unknown, foreign or unrequested approval is refused as not found', () => {
  const claims = approvalClaims([line({ approval_proposal_id: 'proposal-1' })], limit);
  expect(decide(claims, [])[0]?.refusal).toBe('NOT_FOUND');
  expect(decide(claims, [proposal({ branch_id: 'branch-2' })])[0]?.refusal).toBe('NOT_FOUND');
  expect(decide(claims, [proposal({ requested_by: 'user-2' })])[0]?.refusal).toBe('NOT_FOUND');
  expect(decide(claims, [proposal({ requested_by_membership_id: 'membership-2' })])[0]?.refusal).toBe('NOT_FOUND');
});

it('a pending or a rejected approval is refused as not approved, and a lapsed one as expired', () => {
  const claims = approvalClaims([line({ approval_proposal_id: 'proposal-1' })], limit);
  expect(decide(claims, [proposal({ status: 'PENDING' })])[0]?.refusal).toBe('NOT_APPROVED');
  expect(decide(claims, [proposal({ status: 'REJECTED' })])[0]?.refusal).toBe('NOT_APPROVED');
  expect(decide(claims, [proposal({ expires_at: now })])[0]?.refusal).toBe('EXPIRED');
  expect(decide(claims, [proposal({ expires_at: new Date(now.getTime() - 1) })])[0]?.refusal).toBe('EXPIRED');
  expect(decide(claims, [proposal({ status: 'CONSUMED' })])[0]?.refusal).toBe('CONSUMED');
});

it('any changed term refuses the approval, and the branch rule comes before the hash', () => {
  const changed = [
    line({ approval_proposal_id: 'proposal-1', discount: 5500n, net: 19500n, effective_discount_bps: 2200 }),
    line({ approval_proposal_id: 'proposal-1', price: 24000n, net: 19000n, effective_discount_bps: 2400 }),
    line({ approval_proposal_id: 'proposal-1', service: { ...service, id: 'service-2' } }),
    line({ approval_proposal_id: 'proposal-1', performers: [{ employee: { ...employee, id: 'employee-2' }, share_bps: 10000, not_clocked_in_warning: false, approved_leave_warning: false }] }),
  ];
  for (const item of changed) {
    const decision = decide(approvalClaims([item], limit), [proposal()])[0];
    expect(decision?.refusal).toBe('TERMS_MISMATCH');
  }
  const otherCustomer = decide(approvalClaims([line({ approval_proposal_id: 'proposal-1' })], limit), [proposal()], { ...facts, customer_id: 'customer-2' });
  expect(otherCustomer[0]?.refusal).toBe('TERMS_MISMATCH');
  const otherDate = decide(approvalClaims([line({ approval_proposal_id: 'proposal-1' })], limit), [proposal()], { ...facts, occurred_business_date: '2026-10-22' });
  expect(otherDate[0]?.refusal).toBe('TERMS_MISMATCH');
  const otherVisit = decide(approvalClaims([line({ approval_proposal_id: 'proposal-1' })], limit), [proposal()], { ...facts, session_id: 'session-2' });
  expect(otherVisit[0]?.refusal).toBe('TERMS_MISMATCH');
  const otherBranch = decide(approvalClaims([line({ approval_proposal_id: 'proposal-1' })], limit), [proposal()], { ...facts, branch_id: 'branch-2' });
  expect(otherBranch[0]?.refusal).toBe('TERMS_MISMATCH');
  const foreignBranch = decide(approvalClaims([line({ approval_proposal_id: 'proposal-1' })], limit), [proposal({ branch_id: 'branch-2' })]);
  expect(foreignBranch[0]?.refusal).toBe('NOT_FOUND');
});

it('identical terms consume the approval and carry the recomputed hash', () => {
  const claims = approvalClaims([line({ approval_proposal_id: 'proposal-1' })], limit);
  const decision = decide(claims, [proposal()])[0];
  expect(decision?.refusal).toBeNull();
  expect(decision?.terms_hash).toBe(hashOf(line()));
});

it('the same approval twice in one request refuses the second line as consumed', () => {
  const first = line({ input_index: 0, approval_proposal_id: 'proposal-1' });
  const second = line({ input_index: 1, approval_proposal_id: 'proposal-1' });
  const decisions = decide(approvalClaims([first, second], limit), [proposal()]);
  expect(decisions.map((decision) => decision.refusal)).toEqual([null, 'CONSUMED']);
});

it('a refused first line leaves the approval open for the second one', () => {
  const first = line({ input_index: 0, approval_proposal_id: 'proposal-1', discount: 5500n, net: 19500n, effective_discount_bps: 2200 });
  const second = line({ input_index: 1, approval_proposal_id: 'proposal-1' });
  const decisions = decide(approvalClaims([first, second], limit), [proposal()]);
  expect(decisions.map((decision) => decision.refusal)).toEqual(['TERMS_MISMATCH', null]);
});

it('the consumption audit names the proposal, the line and the visit without a name or a phone', () => {
  const accepted = recordedSessionLine({ ...line({ approval_proposal_id: 'proposal-1' }), consumed_proposal_id: 'proposal-1' },
    { id: 'line-1', session_id: 'session-1', ordinal: 1, performer_ids: ['performer-1'] },
    { userId: 'user-1', membershipId: 'membership-1', at: now, late: false }, limit);
  const audits = discountConsumptionAudits([accepted], 'session-1');
  expect(audits).toEqual([{ entity: 'discount_proposal', entityId: 'proposal-1', action: 'discount_proposal.consumed',
    after: { proposal_id: 'proposal-1', line_id: 'line-1', session_id: 'session-1' } }]);
  expect(JSON.stringify(audits)).not.toContain('phone');
  expect(discountConsumptionAudits([recordedSessionLine(line(), { id: 'line-2', session_id: 'session-1', ordinal: 2, performer_ids: [] },
    { userId: 'user-1', membershipId: 'membership-1', at: now, late: false }, limit)], 'session-1')).toEqual([]);
});

it('a consumed line is accepted with its proposal and keeps the recorder own limit', () => {
  const prepared = line({ approval_proposal_id: 'proposal-1' });
  const decisions = decide(approvalClaims([prepared], limit), [proposal()]);
  const plan = planSessionWrite([prepared], limit, [], messages, decisions);
  expect(plan.outcome).toBe('COMPLETE');
  expect(plan.accepted).toHaveLength(1);
  expect(plan.accepted[0]?.consumed_proposal_id).toBe('proposal-1');
  const saved = recordedSessionLine(plan.accepted[0] as PreparedSessionLine,
    { id: 'line-1', session_id: 'session-1', ordinal: 1, performer_ids: ['performer-1'] },
    { userId: 'user-1', membershipId: 'membership-1', at: now, late: false }, limit);
  expect(saved.discount_proposal_id).toBe('proposal-1');
  expect(saved.limit).toEqual(limit);
  expect(JSON.stringify(sessionLineSnapshot(saved))).toContain('"discount_proposal_id":"proposal-1"');
  const plain = recordedSessionLine(line(), { id: 'line-2', session_id: 'session-1', ordinal: 2, performer_ids: ['performer-2'] },
    { userId: 'user-1', membershipId: 'membership-1', at: now, late: false }, limit);
  expect(Object.keys(sessionLineSnapshot(plain))).not.toContain('discount_proposal_id');
});

it('a refused line carries the refusal and the proposal id, and the outcome is partial', () => {
  const prepared = line({ approval_proposal_id: 'proposal-1' });
  const ordinary = line({ input_index: 1, effective_discount_bps: 0, discount: 0n, net: 25000n });
  const decisions = decide(approvalClaims([prepared], limit), [proposal({ status: 'PENDING' })]);
  const plan = planSessionWrite([prepared, ordinary], limit, [], messages, decisions);
  expect(plan.outcome).toBe('PARTIAL');
  expect(plan.accepted.map((item) => item.input_index)).toEqual([1]);
  expect(plan.rejected_lines[0]).toMatchObject({ input_index: 0, approval_refusal: 'NOT_APPROVED', discount_proposal_id: 'proposal-1' });
});

it('a line above the limit with no decision keeps the plain rejection of today', () => {
  const prepared = line({ approval_proposal_id: 'proposal-1' });
  const ordinary = line({ input_index: 1, effective_discount_bps: 0, discount: 0n, net: 25000n });
  const plan = planSessionWrite([prepared, ordinary], limit, [], messages);
  expect(plan.rejected_lines[0]).toMatchObject({ input_index: 0, code: 'SESSION_DISCOUNT_ABOVE_LIMIT', limit_bps: 1000, limit_source: 'PERSON' });
  expect(onlyItem(plan.rejected_lines)).not.toHaveProperty('approval_refusal');
  expect(onlyItem(plan.rejected_lines)).not.toHaveProperty('discount_proposal_id');
  expect(() => planSessionWrite([prepared], limit, [], messages)).toThrow('SESSION_DISCOUNT_ABOVE_LIMIT');
});

it('every refused line refuses the whole request with the refusal inside', () => {
  const prepared = line({ approval_proposal_id: 'proposal-1' });
  const decisions = decide(approvalClaims([prepared], limit), [proposal({ status: 'PENDING' })]);
  expect(() => planSessionWrite([prepared], limit, [], messages, decisions)).toThrow('SESSION_DISCOUNT_ABOVE_LIMIT');
  try {
    planSessionWrite([prepared], limit, [], messages, decisions);
  } catch (error) {
    const details = (error as { details?: { rejected_lines?: { approval_refusal?: string; discount_proposal_id?: string }[] } }).details;
    expect(details?.rejected_lines?.[0]?.approval_refusal).toBe('NOT_APPROVED');
    expect(details?.rejected_lines?.[0]?.discount_proposal_id).toBe('proposal-1');
  }
});

it('the four argument plan is unchanged by the decisions', () => {
  const prepared = line();
  expect(planSessionWrite([prepared], { source: 'OWNER', bps: null }, [], messages)).toMatchObject({ accepted: [prepared], rejected_lines: [], ordinals: [1], outcome: 'COMPLETE' });
  const terms: DiscountTermsV1 = termsOf(prepared);
  expect(terms.net).toBe('20.000');
});
