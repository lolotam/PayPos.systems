import { expect, it } from 'vitest';
import {
  approveDiscountProposalsInput,
  deviceApproveDiscountProposalsInput,
  deviceDiscountProposal,
  deviceRejectDiscountProposalsInput,
  rejectDiscountProposalsInput,
  requestDiscountApprovalInput,
  requestDiscountApprovalResponse,
} from './discount-approval.js';
import { discountApprovalNoticeRequested, discountApprovalRequested } from './discount-approval-events.js';
import { appendServiceSessionLinesInput, rejectedServiceLine, savedServiceLine } from './service-session.js';

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
  const keys = Object.keys(deviceDiscountProposal.shape);
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
