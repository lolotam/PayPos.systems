import { describe, expect, it } from 'vitest';
import { DiscountApprovalError } from '../discount-approval-error.ts';
import { planDiscountRequest, requesterRole, type DiscountRequestPlanInput } from '../discount-request.ts';
import { discountRequestAudits, discountRequestEvent, discountRequestResponse } from '../discount-request-records.ts';
import { buildDiscountTerms, canonicalDiscountTerms, discountTermsHash } from '../discount-terms.ts';
import type { PreparedSessionLine, SessionEmployee, SessionLimit, SessionService } from '../session-types.ts';

// The real SHA-256 arrives with the adapter; the domain may not import node:crypto, so the test brings its own.
const fakeSha256 = (text: string): string => {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return hash.toString(16).padStart(8, '0').repeat(8);
};

const service = (id: string, price = 25000n, nameAr: string | null = null): SessionService => ({
  id, name_en: `Service ${id}`, name_ar: nameAr, price, rule: { kind: 'FOLLOW_PLAN' }, counts: true, revision: 1,
});

const employee = (id: string, nameEn: string, nameAr: string | null = null, userId: string | null = null): SessionEmployee => ({
  id, name_en: nameEn, name_ar: nameAr, user_id: userId, eligible: true, clocked_in: true, approved_leave: false,
});

const line = (
  inputIndex: number,
  serviceId: string,
  price: bigint,
  discount: bigint,
  effectiveBps: number,
  performers: SessionEmployee[] = [employee('employee-1', 'Sara Performer', 'سارة أحمد')],
): PreparedSessionLine => ({
  input_index: inputIndex,
  service: service(serviceId),
  price,
  discount,
  net: price - discount,
  effective_discount_bps: effectiveBps,
  performers: performers.map((person) => ({ employee: person, share_bps: 10000, not_clocked_in_warning: false, approved_leave_warning: false })),
  has_performer_warning: false,
  explicit_unequal_shares: false,
});

const LIMIT: SessionLimit = { source: 'PERSON', bps: 1000 };

const input = (overrides: {
  lines?: readonly PreparedSessionLine[];
  limit?: SessionLimit;
  proposal_ids?: readonly string[];
  performer_row_ids?: readonly string[];
  requester?: DiscountRequestPlanInput['requester'];
} = {}): DiscountRequestPlanInput => ({
  lines: overrides.lines ?? [line(0, 'service-1', 25000n, 5000n, 2000)],
  limit: overrides.limit ?? LIMIT,
  company_id: 'company-1',
  business_id: 'business-1',
  branch_id: 'branch-1',
  customer_id: 'customer-1',
  session_id: 'session-1',
  occurred_at: new Date('2026-10-21T08:00:00.000Z'),
  occurred_business_date: '2026-10-21',
  requested_at: new Date('2026-10-21T09:00:00.000Z'),
  requested_by: 'user-1',
  requested_by_membership_id: 'membership-1',
  requester: overrides.requester ?? {
    role: { code: 'cashier', is_system: true, name_ar: null, name_en: 'Cashier' },
    name_en: null,
    name_ar: null,
  },
  customer_name: 'Nawara Customer',
  request_id: 'request-1',
  proposal_ids: overrides.proposal_ids ?? ['proposal-1'],
  performer_row_ids: overrides.performer_row_ids ?? ['performer-row-1'],
  sha256Hex: fakeSha256,
});

describe('the request that needs no approval is refused as a whole', () => {
  it('lists every line inside the limit, ascending, and returns nothing else', () => {
    const attempt = () => planDiscountRequest(input({
      lines: [
        line(0, 'service-1', 25000n, 5000n, 2000),
        line(1, 'service-2', 25000n, 1000n, 400),
        line(2, 'service-3', 25000n, 5000n, 2000),
      ],
      proposal_ids: ['proposal-1', 'proposal-2', 'proposal-3'],
      performer_row_ids: ['row-1', 'row-2', 'row-3'],
    }));
    expect(attempt).toThrow(DiscountApprovalError);
    try {
      attempt();
    } catch (error) {
      expect(error).toMatchObject({ code: 'DISCOUNT_APPROVAL_NOT_NEEDED', details: { input_indexes: [1] } });
      expect(Object.keys((error as { details: object }).details)).toEqual(['input_indexes']);
    }
  });

  it('refuses the owner, whose limit never needs an approval', () => {
    const attempt = () => planDiscountRequest(input({ limit: { source: 'OWNER', bps: null } }));
    expect(attempt).toThrow(DiscountApprovalError);
    try {
      attempt();
    } catch (error) {
      expect(error).toMatchObject({ code: 'DISCOUNT_APPROVAL_NOT_NEEDED', details: { input_indexes: [0] } });
    }
  });

  it('refuses a limit of zero against a discount of zero, because zero needs no approval', () => {
    const attempt = () => planDiscountRequest(input({
      limit: { source: 'NOT_CONFIGURED', bps: 0 },
      lines: [line(0, 'service-1', 25000n, 0n, 0)],
    }));
    expect(attempt).toThrow(DiscountApprovalError);
  });

  it('refuses a line exactly at the limit, because the limit itself is inside it', () => {
    const attempt = () => planDiscountRequest(input({
      limit: { source: 'PERSON', bps: 1000 },
      lines: [line(0, 'service-1', 25000n, 2500n, 1000)],
    }));
    expect(attempt).toThrow(DiscountApprovalError);
  });

  it('accepts any discount above a limit of zero', () => {
    const proposals = planDiscountRequest(input({
      limit: { source: 'NOT_CONFIGURED', bps: 0 },
      lines: [line(0, 'service-1', 25000n, 500n, 200)],
    }));
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.requester_limit_source).toBe('NOT_CONFIGURED');
    expect(proposals[0]?.requester_limit_bps).toBe(0);
  });
});

describe('the proposal the approver will read', () => {
  it('hashes the same terms the recording domain builds', () => {
    const proposal = planDiscountRequest(input())[0];
    const terms = buildDiscountTerms({
      company_id: 'company-1', business_id: 'business-1', branch_id: 'branch-1', customer_id: 'customer-1',
      session_id: 'session-1', service_id: 'service-1', requested_by: 'user-1', requested_by_membership_id: 'membership-1',
      occurred_business_date: '2026-10-21', list_price: 25000n, price: 25000n, discount: 5000n, performer_ids: ['employee-1'],
    });
    expect(proposal?.terms_hash).toBe(discountTermsHash(terms, fakeSha256));
    expect(proposal?.terms_text).toBe(canonicalDiscountTerms(terms));
    expect(proposal?.effective_bps).toBe(2000);
  });

  it('expires twenty-four hours after the request and never later', () => {
    const proposal = planDiscountRequest(input())[0];
    expect(proposal?.expires_at.toISOString()).toBe('2026-10-22T09:00:00.000Z');
    expect(proposal?.requested_at.toISOString()).toBe('2026-10-21T09:00:00.000Z');
  });

  it('cuts the first names once, on a space, a tab and a non-breaking space', () => {
    const performers = [
      employee('employee-1', 'Sara Performer', 'سارة أحمد'),
      employee('employee-2', 'Layla\tEditor', null),
      employee('employee-3', `Mona${String.fromCharCode(160)}Said`, 'منى سعيد'),
    ];
    const proposal = planDiscountRequest(input({
      lines: [line(0, 'service-1', 25000n, 5000n, 2000, performers)],
      performer_row_ids: ['row-1', 'row-2', 'row-3'],
    }))[0];
    expect(proposal?.performers.map((performer) => performer.first_name_en)).toEqual(['Sara', 'Layla', 'Mona']);
    expect(proposal?.performers.map((performer) => performer.first_name_ar)).toEqual(['سارة', null, 'منى']);
    expect(proposal?.customer_first_name).toBe('Nawara');
  });

  it('keeps the performer link and the role of the requester', () => {
    const performers = [employee('employee-1', 'Sara Performer', 'سارة أحمد', 'user-9')];
    const proposal = planDiscountRequest(input({
      lines: [line(0, 'service-1', 25000n, 5000n, 2000, performers)],
      requester: { role: { code: 'branch_manager', is_system: true, name_ar: null, name_en: 'Branch Manager' }, name_en: 'Layla Editor', name_ar: 'ليلى' },
    }))[0];
    expect(proposal?.performers[0]?.linked_user_id).toBe('user-9');
    expect(proposal?.requester_role).toBe('branch_manager');
    expect(proposal?.requester_role_is_system).toBe(true);
    expect(proposal?.requester_role_name_en).toBe('Branch Manager');
    expect(proposal?.requester_first_name_en).toBe('Layla');
    expect(proposal?.requester_first_name_ar).toBe('ليلى');
  });

  it('leaves a null Arabic name null', () => {
    const proposal = planDiscountRequest(input({
      requester: { role: { code: 'cashier', is_system: true, name_ar: null, name_en: 'Cashier' }, name_en: 'Mona Cashier', name_ar: null },
    }))[0];
    expect(proposal?.requester_name_ar).toBeNull();
    expect(proposal?.requester_first_name_ar).toBeNull();
    expect(proposal?.requester_first_name_en).toBe('Mona');
  });
});

describe('what the bell and the audit see', () => {
  const proposals = planDiscountRequest(input({
    lines: [
      line(0, 'service-1', 25000n, 5000n, 2000),
      line(1, 'service-2', 25000n, 7500n, 3000),
      line(2, 'service-1', 25000n, 5000n, 2000),
    ],
    proposal_ids: ['proposal-1', 'proposal-2', 'proposal-3'],
    performer_row_ids: ['row-1', 'row-2', 'row-3'],
  }));

  it('counts the lines, takes the largest percentage and names each service once', () => {
    const event = discountRequestEvent(proposals, {
      request_id: 'request-1', business_id: 'business-1', branch_id: 'branch-1', requested_by: 'user-1',
      occurred_at: new Date('2026-10-21T08:00:00.000Z'),
    });
    expect(event.line_count).toBe(3);
    expect(event.max_effective_bps).toBe(3000);
    expect(event.services.map((entry) => entry.service_id)).toEqual(['service-1', 'service-2']);
    expect(event.occurred_at).toBe('2026-10-21T08:00:00.000Z');
  });

  it('writes one audit entry per proposal with no name, no first name and no phone', () => {
    const audits = discountRequestAudits(proposals);
    expect(audits).toHaveLength(3);
    expect(audits[0]).toMatchObject({
      entity: 'discount_proposal',
      entityId: 'proposal-1',
      action: 'discount_proposal.requested',
      after: { request_id: 'request-1', input_index: 0, kind: 'RECORD', session_id: 'session-1', effective_bps: 2000 },
    });
    const printed = JSON.stringify(audits);
    expect(printed).not.toContain('Nawara');
    expect(printed).not.toContain('Sara');
    expect(printed).not.toContain('سارة');
  });

  it('answers the request with the pending proposals in the order of the request', () => {
    const response = discountRequestResponse('request-1', new Date('2026-10-21T08:00:00.000Z'), proposals);
    expect(response.request_id).toBe('request-1');
    expect(response.occurred_at).toBe('2026-10-21T08:00:00.000Z');
    expect(response.proposals.map((proposal) => proposal.input_index)).toEqual([0, 1, 2]);
    expect(response.proposals[0]?.status).toBe('PENDING');
    expect(response.proposals[0]?.expires_at).toBe('2026-10-22T09:00:00.000Z');
  });
});

describe('the role of the membership that asked', () => {
  const memberships = [
    { membership_id: 'membership-1', role: { code: 'cashier', is_system: true, name_ar: null, name_en: 'Cashier' } },
    { membership_id: 'membership-2', role: { code: 'branch_manager', is_system: true, name_ar: null, name_en: 'Branch Manager' } },
  ];

  it('finds the role of the chosen membership', () => {
    expect(requesterRole(memberships, 'membership-2').code).toBe('branch_manager');
  });

  it('refuses a membership that is not there', () => {
    expect(() => requesterRole(memberships, 'membership-9')).toThrow('FORBIDDEN');
  });
});
