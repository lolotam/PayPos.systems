import { expect, it, vi } from 'vitest';
import {
  approveDiscountProposalsInput,
  decidedDiscountProposal,
  deviceApproveDiscountProposalsInput,
  deviceDiscountProposal,
  deviceDiscountProposalList,
  deviceDiscountProposalQuery,
  deviceRejectDiscountProposalsInput,
  pendingDiscountProposal,
  rejectDiscountProposalsInput,
  requestedDiscountProposal,
  requestDiscountApprovalEditInput,
  requestDiscountApprovalInput,
  requestDiscountApprovalResponse,
  requesterDiscountProposal,
} from './discount-approval.js';
import { notificationRequest } from '../notifications.js';
import {
  discountApprovalNoticeRequested,
  discountApprovalRequested,
  discountApprovedByPerformer,
  discountSelfApprovalNoticeRequested,
} from './discount-approval-events.js';
import {
  appendServiceSessionLinesInput,
  editServiceLineInput,
  rejectedServiceLine,
  savedServiceLine,
} from './service-session.js';

const A = '01990000-0000-7000-8000-00000000000a';
const B = '01990000-0000-7000-8000-00000000000b';
const C = '01990000-0000-7000-8000-00000000000c';
const HASH = 'a'.repeat(64);
const line = {
  service_id: A,
  price: '25.000',
  discount: { kind: 'AMOUNT', amount: '5.000' },
  performers: [{ employee_id: B }],
};
const request = { customer_id: C, lines: [line] };

it('accepts the spec 050 draft line unchanged and refuses a proposal id inside a request', () => {
  expect(requestDiscountApprovalInput.safeParse(request).success).toBe(true);
  expect(requestDiscountApprovalInput.safeParse({ ...request, lines: [{ ...line, discount_proposal_id: A }] }).success)
    .toBe(false);
  expect(requestDiscountApprovalInput.safeParse({ ...request, lines: Array(21).fill(line) }).success).toBe(false);
});

it('refuses occurred_at together with session_id and accepts either alone', () => {
  const at = '2026-10-21T10:00:00.000Z';
  expect(requestDiscountApprovalInput.safeParse({ ...request, session_id: A }).success).toBe(true);
  expect(requestDiscountApprovalInput.safeParse({ ...request, occurred_at: at }).success).toBe(true);
  expect(requestDiscountApprovalInput.safeParse({ ...request, session_id: A, occurred_at: at }).success).toBe(false);
});

it('returns proposals with a lowercase hex terms hash and a bps above zero', () => {
  const proposal = { id: A, input_index: 0, status: 'PENDING', expires_at: '2026-10-21T10:15:00.000Z', effective_bps: 2000, terms_hash: HASH };
  const response = { request_id: B, occurred_at: '2026-10-21T10:00:00.000Z', proposals: [proposal] };
  expect(requestDiscountApprovalResponse.safeParse(response).success).toBe(true);
  expect(requestDiscountApprovalResponse.safeParse({ ...response, proposals: [{ ...proposal, terms_hash: 'A'.repeat(64) }] }).success).toBe(false);
  expect(requestDiscountApprovalResponse.safeParse({ ...response, proposals: [{ ...proposal, effective_bps: 0 }] }).success).toBe(false);
});

it('keeps decision ids and hashes paired in order, and lets a long reason reach the domain', () => {
  const decision = { proposal_ids: [A, B], terms_hashes: [HASH, 'b'.repeat(64)] };
  expect(approveDiscountProposalsInput.safeParse(decision).success).toBe(true);
  expect(approveDiscountProposalsInput.safeParse({ ...decision, terms_hashes: [HASH] }).success).toBe(false);
  expect(approveDiscountProposalsInput.safeParse({ ...decision, proposal_ids: [A, A] }).success).toBe(false);
  expect(approveDiscountProposalsInput.safeParse({ ...decision, reason: 'x' }).success).toBe(false);
  expect(rejectDiscountProposalsInput.safeParse({ ...decision, reason: 'x'.repeat(600) }).success).toBe(true);
});

it('takes a canonical phone and a four-digit PIN on the device routes only', () => {
  const decision = { proposal_ids: [A], terms_hashes: [HASH], phone: '+96550000000', pin: '1234' };
  expect(deviceApproveDiscountProposalsInput.safeParse(decision).success).toBe(true);
  expect(deviceRejectDiscountProposalsInput.safeParse({ ...decision, reason: 'الخصم كبير' }).success).toBe(true);
  expect(deviceApproveDiscountProposalsInput.safeParse({ ...decision, pin: '12345' }).success).toBe(false);
  expect(deviceApproveDiscountProposalsInput.safeParse({ ...decision, phone: '50000000' }).success).toBe(false);
  expect(approveDiscountProposalsInput.safeParse(decision).success).toBe(false);
});

it('projects no phone and no performer on the device list', () => {
  const keys = deviceDiscountProposal.options.flatMap((option) => Object.keys(option.shape));
  expect(keys.filter((key) => /phone|performer|customer_name|customer_id/.test(key))).toEqual([]);
});

it('adds the proposal fields to the spec 050 shapes as optional only', () => {
  const append = { lines: [{ ...line, discount_proposal_id: A }] };
  expect(appendServiceSessionLinesInput.safeParse(append).success).toBe(true);
  expect(appendServiceSessionLinesInput.safeParse({ lines: [line] }).success).toBe(true);
  expect(savedServiceLine.shape.discount_proposal_id.safeParse(undefined).success).toBe(true);
  expect(rejectedServiceLine.shape.approval_refusal.safeParse('TERMS_MISMATCH').success).toBe(true);
  expect(rejectedServiceLine.shape.approval_refusal.safeParse('LIMIT').success).toBe(false);
});

const requested = {
  schema_version: 1, request_id: A, business_id: B, branch_id: C, requested_by: A, line_count: 3,
  max_effective_bps: 3000, services: [{ service_id: A, name_en: 'Colour', name_ar: 'صبغة' }],
  occurred_at: '2026-10-21T10:00:00.000Z',
};

it('carries distinct services from the request snapshots and no customer', () => {
  expect(discountApprovalRequested.safeParse(requested).success).toBe(true);
  const twice = { ...requested, services: [requested.services[0], requested.services[0]] };
  expect(discountApprovalRequested.safeParse(twice).success).toBe(false);
  expect(discountApprovalRequested.safeParse({ ...requested, line_count: 0 }).success).toBe(false);
  expect(discountApprovalRequested.safeParse({ ...requested, customer_id: A }).success).toBe(false);
});

const recipient = (lineCount: string, percent: string) => ({
  channel: 'IN_APP', user_id: A, locale: 'ar', template_revision: 1, template_key: 'discount_approval_requested',
  safe_parameters: [
    { name: 'branch_name_ar', type: 'text', value: 'السالمية' },
    { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
    { name: 'service_name_ar', type: 'text', value: 'صبغة' },
    { name: 'service_name_en', type: 'text', value: 'Colour' },
    { name: 'line_count', type: 'text', value: lineCount },
    { name: 'max_percent', type: 'text', value: percent },
  ],
});

it.each([['1', '20'], ['20', '20.5'], ['3', '0.01'], ['2', '100']])('accepts %s lines up to %s%%', (count, percent) => {
  const notice = { schema_version: 1, request_id: A, business_id: B, branch_id: C, notification_recipients: [recipient(count, percent)] };
  expect(discountApprovalNoticeRequested.safeParse(notice).success).toBe(true);
});

it.each([['0', '20'], ['21', '20'], ['1', '2000'], ['1', '20.50'], ['1', '0'], ['1', '100.5']])(
  'refuses %s lines at %s%%',
  (count, percent) => {
    const notice = { schema_version: 1, request_id: A, business_id: B, branch_id: C, notification_recipients: [recipient(count, percent)] };
    expect(discountApprovalNoticeRequested.safeParse(notice).success).toBe(false);
  },
);

it('passes the notifications consumer parser for both bells', () => {
  const notice = { schema_version: 1, request_id: A, business_id: B, branch_id: C, notification_recipients: [recipient('3', '20')] };
  expect(notificationRequest.safeParse(notice).success).toBe(true);
  const owner = {
    schema_version: 1, business_id: B, branch_id: C, proposal_ids: [A],
    notification_recipients: [{
      channel: 'IN_APP', user_id: A, locale: 'ar', template_revision: 1, template_key: 'discount_self_approved',
      safe_parameters: [
        { name: 'branch_name_ar', type: 'text', value: 'السالمية' },
        { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
        { name: 'approver_name_ar', type: 'text', value: 'هبة' },
        { name: 'approver_name_en', type: 'text', value: 'Heba' },
        { name: 'service_name_ar', type: 'text', value: 'صبغة' },
        { name: 'service_name_en', type: 'text', value: 'Colour' },
        { name: 'max_percent', type: 'text', value: '30' },
      ],
    }],
  };
  expect(discountSelfApprovalNoticeRequested.safeParse(owner).success).toBe(true);
  expect(notificationRequest.safeParse(owner).success).toBe(true);
});

it('names the performer approval for the owner bell with distinct proposals only', () => {
  const proposal = { id: A, service_id: C, name_en: 'Colour', name_ar: 'صبغة', effective_bps: 3000 };
  const event = {
    schema_version: 1, business_id: B, branch_id: C, decided_by: A, decider_label_en: 'Heba', decider_label_ar: 'هبة',
    decided_via: 'PIN', proposals: [proposal],
  };
  expect(discountApprovedByPerformer.safeParse(event).success).toBe(true);
  expect(discountApprovedByPerformer.safeParse({ ...event, proposals: [proposal, proposal] }).success).toBe(false);
  expect(discountApprovedByPerformer.safeParse({ ...event, decided_via: 'DEVICE' }).success).toBe(false);
});

it('lets a saved-line edit carry an approval like recording does (DA-Q5)', () => {
  const edit = { price: '25.000', discount: { kind: 'AMOUNT', amount: '5.000' }, reason: 'x', expected_revision: 1 };
  expect(editServiceLineInput.safeParse({ ...edit, discount_proposal_id: A }).success).toBe(true);
  expect(editServiceLineInput.safeParse(edit).success).toBe(true);
});

it('asks an edit approval with the 35d edit body minus the reason (DA-Q5, FR-025)', () => {
  const body = { price: '25.000', discount: { kind: 'PERCENT', bps: 3000 }, expected_revision: 2 };
  expect(requestDiscountApprovalEditInput.safeParse(body).success).toBe(true);
  expect(requestDiscountApprovalEditInput.safeParse({ ...body, reason: 'x' }).success).toBe(false);
  expect(requestDiscountApprovalEditInput.safeParse({ ...body, discount_proposal_id: A }).success).toBe(false);
});

const AT = '2026-10-21T10:00:00.000Z';
const EXPIRES = '2026-10-21T10:15:00.000Z';
const requesterProposal: Record<string, unknown> = {
  id: A, request_id: B, input_index: 0, status: 'PENDING', session_id: null, occurred_at: AT,
  service_id: A, service_name_en: 'Colour', service_name_ar: 'صبغة',
  list_price: '25.000', price: '25.000', discount: '5.000', net: '20.000',
  effective_bps: 2000, expires_at: EXPIRES, terms_hash: HASH,
};
const pendingProposal: Record<string, unknown> = {
  id: A, request_id: B, session_id: null, occurred_at: AT,
  service_id: A, service_name_en: 'Colour', service_name_ar: 'صبغة',
  list_price: '25.000', price: '25.000', discount: '5.000', net: '20.000',
  effective_bps: 2000, performers: [{ employee_id: B, first_name_en: 'Heba', first_name_ar: 'هبة' }],
  requester_label_ar: 'المالكة', requester_label_en: 'Owner', customer_first_name: 'Sara',
  requested_at: AT, expires_at: EXPIRES, terms_hash: HASH,
};
const deviceProposal: Record<string, unknown> = {
  id: A, request_id: B, service_name_en: 'Colour', service_name_ar: 'صبغة',
  list_price: '25.000', price: '25.000', discount: '5.000', net: '20.000',
  effective_bps: 2000, requester_first_name_en: 'Heba', requester_first_name_ar: 'هبة',
  customer_first_name: 'Sara', requested_at: AT, expires_at: EXPIRES, terms_hash: HASH,
};
const editKind = {
  kind: 'EDIT', line_id: A, base_revision: 2,
  base_price: '30.000', base_discount: '5.000', base_net: '25.000',
};
type ProposalParser = { safeParse: (value: unknown) => { success: boolean } };

// التسجيل يحمل kind وحده، والتعديل يحمل حقول الـ base كلها؛ فأي نقص في حقول التعديل يرفض الرد.
const expectClosedKind = (schema: ProposalParser, base: Record<string, unknown>) => {
  expect(schema.safeParse({ ...base, kind: 'RECORD' }).success).toBe(true);
  expect(schema.safeParse({ ...base, ...editKind }).success).toBe(true);
  for (const key of ['line_id', 'base_revision', 'base_price', 'base_discount', 'base_net']) {
    const partial = Object.fromEntries(Object.entries(editKind).filter(([name]) => name !== key));
    expect(schema.safeParse({ ...base, ...partial }).success).toBe(false);
  }
};

it('closes the kind contract on every proposal shape', () => {
  expectClosedKind(requesterDiscountProposal, requesterProposal);
  expectClosedKind(pendingDiscountProposal, pendingProposal);
  expectClosedKind(deviceDiscountProposal, deviceProposal);
});

it('keeps a stored rejection reason of 500 astral characters (the CHECK counts characters)', () => {
  const rejected = { ...requesterProposal, kind: 'RECORD', status: 'REJECTED', reject_reason: '😀'.repeat(500) };
  expect(requesterDiscountProposal.safeParse(rejected).success).toBe(true);
});

it('refuses a null expiry on every proposal shape (FR-010: it is never null)', () => {
  const proposal = { id: A, input_index: 0, status: 'PENDING', expires_at: null, effective_bps: 2000, terms_hash: HASH };
  expect(requestedDiscountProposal.safeParse(proposal).success).toBe(false);
  expect(requesterDiscountProposal.safeParse({ ...requesterProposal, kind: 'RECORD', expires_at: null }).success).toBe(false);
  expect(pendingDiscountProposal.safeParse({ ...pendingProposal, kind: 'RECORD', expires_at: null }).success).toBe(false);
  expect(deviceDiscountProposal.safeParse({ ...deviceProposal, kind: 'RECORD', expires_at: null }).success).toBe(false);
  expect(decidedDiscountProposal.safeParse({ id: A, status: 'APPROVED', expires_at: EXPIRES }).success).toBe(true);
  expect(decidedDiscountProposal.safeParse({ id: A, status: 'REJECTED', expires_at: EXPIRES }).success).toBe(true);
  expect(decidedDiscountProposal.safeParse({ id: A, status: 'APPROVED', expires_at: null }).success).toBe(false);
  expect(decidedDiscountProposal.safeParse({ id: A, status: 'REJECTED', expires_at: null }).success).toBe(false);
});

it('drops a field the browser does not know yet, and an edit field a RECORD carries with it', () => {
  const parsed = requesterDiscountProposal.safeParse({ ...requesterProposal, kind: 'RECORD', future_field: 'x', line_id: A });
  expect(parsed.success).toBe(true);
  const keys = parsed.success ? Object.keys(parsed.data) : [];
  expect(keys).not.toContain('future_field');
  expect(keys).not.toContain('line_id');
});

// الحصرية على RECORD بتشتغل في الوضع الصارم (اختبارات الـ API): responseObject بيبقى strict فالمفتاح الزيادة مرفوض.
it('refuses a RECORD that carries an edit field when the responses are strict', async () => {
  vi.stubEnv('POSPAY_STRICT_RESPONSES', '1');
  vi.resetModules();
  try {
    const strict = await import('./discount-approval.js');
    expect(strict.requesterDiscountProposal.safeParse({ ...requesterProposal, kind: 'RECORD', line_id: A }).success).toBe(false);
    expect(strict.pendingDiscountProposal.safeParse({ ...pendingProposal, kind: 'RECORD', line_id: A }).success).toBe(false);
    expect(strict.deviceDiscountProposal.safeParse({ ...deviceProposal, kind: 'RECORD', line_id: A }).success).toBe(false);
  } finally {
    vi.unstubAllEnvs();
    vi.resetModules();
  }
});

it('pages the device list like the pending one and closes its query', () => {
  expect(deviceDiscountProposalQuery.safeParse({ limit: 20 }).success).toBe(true);
  expect(deviceDiscountProposalQuery.safeParse({ limit: 20, branch_id: A }).success).toBe(false);
  expect(deviceDiscountProposalQuery.safeParse({ cursor: 'abc-123_XYZ' }).success).toBe(true);
  expect(deviceDiscountProposalQuery.safeParse({ cursor: 'abc/123' }).success).toBe(false);
  expect(deviceDiscountProposalList.safeParse({ items: [], next_cursor: null }).success).toBe(true);
});

