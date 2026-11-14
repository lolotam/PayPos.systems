import type { DiscountProposalStatus, RejectedServiceLine, RequesterDiscountProposalList } from '@pospay/contracts';
import { expect, it } from 'vitest';
import { discountApprovalView, latestDiscountApprovalRequests, type TrackedDiscountRequest } from './discount-approval-state';
import type { SessionRecordingResult } from './session-recording-result';
import { id, instant, rejection } from './session-recording-result.fixture';

type Item = RequesterDiscountProposalList['items'][number];
const A = id(10), B = id(11), first = id(51), second = id(52);

function item(idValue: string, inputIndex: number, status: DiscountProposalStatus, requestId = first): Item {
  return { kind: 'RECORD', id: idValue, request_id: requestId, input_index: inputIndex, status, session_id: null,
    occurred_at: instant, service_id: id(5), service_name_en: 'Synthetic service', service_name_ar: null,
    list_price: '7.125', price: '7.125', discount: '0.713', net: '6.412', effective_bps: 1001,
    expires_at: instant, terms_hash: 'a'.repeat(64) };
}

function row(localId: string, refusal?: RejectedServiceLine['approval_refusal'], proposalId?: string): SessionRecordingResult['rejected'][number] {
  return { localId, error: { ...rejection, ...(refusal ? { approval_refusal: refusal } : {}),
    ...(proposalId ? { discount_proposal_id: proposalId } : {}) } };
}

function tracked(requestId: string, localIds: Record<number, string>): TrackedDiscountRequest {
  return { requestId, localIds };
}

it('no request leaves the row requestable and uncovered', () => {
  const view = discountApprovalView([row(A)], [], {});
  expect(view).toMatchObject({ queried: [], requestable: [A], attach: [], lines: { [A]: { proposal: null, covered: false } } });
});

it('unloaded items cover the row to prevent a duplicate request', () => {
  const view = discountApprovalView([row(A)], [tracked(first, { 0: A })], {});
  expect(view.lines[A]).toEqual({ proposal: null, covered: true });
  expect(view.requestable).toEqual([]);
});

it('loaded items without a matching proposal leave the row requestable', () => {
  const view = discountApprovalView([row(A)], [tracked(first, { 0: A })], { [first]: [item(id(60), 1, 'PENDING')] });
  expect(view.lines[A]).toEqual({ proposal: null, covered: false });
  expect(view.requestable).toEqual([A]);
});

it('PENDING covers the row without attaching it', () => {
  const pending = item(id(60), 0, 'PENDING');
  const view = discountApprovalView([row(A)], [tracked(first, { 0: A })], { [first]: [pending] });
  expect(view.lines[A]).toEqual({ proposal: pending, covered: true });
  expect(view.attach).toEqual([]);
});

it('PENDING refused by this proposal becomes requestable without attach', () => {
  const pending = item(id(60), 0, 'PENDING');
  const view = discountApprovalView([row(A, 'TERMS_MISMATCH', id(60))], [tracked(first, { 0: A })], { [first]: [pending] });
  expect(view.lines[A]?.covered).toBe(false);
  expect(view.requestable).toEqual([A]);
  expect(view.attach).toEqual([]);
});

it.each(['NOT_FOUND', 'NOT_APPROVED', 'EXPIRED', 'CONSUMED'] as const)('PENDING refused with %s stays covered without attach', (code) => {
  const pending = item(id(60), 0, 'PENDING');
  const view = discountApprovalView([row(A, code, id(60))], [tracked(first, { 0: A })], { [first]: [pending] });
  expect(view.lines[A]?.covered).toBe(true);
  expect(view.requestable).toEqual([]);
  expect(view.attach).toEqual([]);
});

it('APPROVED covers and attaches the row', () => {
  const approved = item(id(60), 0, 'APPROVED');
  const view = discountApprovalView([row(A)], [tracked(first, { 0: A })], { [first]: [approved] });
  expect(view.lines[A]).toEqual({ proposal: approved, covered: true });
  expect(view.attach).toEqual([{ localId: A, proposalId: id(60) }]);
});

it('APPROVED refused by this proposal becomes requestable without attach', () => {
  const approved = item(id(60), 0, 'APPROVED');
  const view = discountApprovalView([row(A, 'TERMS_MISMATCH', id(60))], [tracked(first, { 0: A })], { [first]: [approved] });
  expect(view.lines[A]?.covered).toBe(false);
  expect(view.requestable).toEqual([A]);
  expect(view.attach).toEqual([]);
});

it('a stale refusal for another proposal does not block the current approval', () => {
  const approved = item(id(60), 0, 'APPROVED');
  const view = discountApprovalView([row(A, 'TERMS_MISMATCH', id(61))], [tracked(first, { 0: A })], { [first]: [approved] });
  expect(view.lines[A]?.covered).toBe(true);
  expect(view.attach).toEqual([{ localId: A, proposalId: id(60) }]);
});

it.each(['REJECTED', 'EXPIRED', 'CONSUMED'] as const)('%s leaves the row requestable', (status) => {
  const view = discountApprovalView([row(A)], [tracked(first, { 0: A })], { [first]: [item(id(60), 0, status)] });
  expect(view.lines[A]?.covered).toBe(false);
  expect(view.requestable).toEqual([A]);
  expect(view.attach).toEqual([]);
});

it('mixed decisions keep querying a request while its remaining row is PENDING', () => {
  const pending = item(id(61), 1, 'PENDING');
  const view = discountApprovalView([row(B)], [tracked(first, { 0: A, 1: B })], { [first]: [pending] });
  expect(view.queried).toEqual([first]);
  expect(view.lines[B]).toEqual({ proposal: pending, covered: true });
});

it('two requests follow the newest request per row', () => {
  const oldA = item(id(60), 0, 'APPROVED'), oldB = item(id(61), 1, 'APPROVED');
  const newA = item(id(62), 0, 'PENDING', second);
  const requests = [tracked(first, { 0: A, 1: B }), tracked(second, { 0: A })];
  const view = discountApprovalView([row(A), row(B)], requests, { [first]: [oldA, oldB], [second]: [newA] });
  expect(view.lines[A]?.proposal).toBe(newA);
  expect(view.lines[B]?.proposal).toBe(oldB);
  expect(view.attach).toEqual([{ localId: B, proposalId: id(61) }]);
});

it('a request with no remaining rejected line drops out of queried', () => {
  const view = discountApprovalView([row(A)], [tracked(first, { 0: B })], {});
  expect(view.queried).toEqual([]);
  expect(view.requestable).toEqual([A]);
});

it('latestDiscountApprovalRequests returns only newest request per row and drops fully covered requests', () => {
  const requests = [tracked(first, { 0: A }), tracked(second, { 0: A })];
  expect(latestDiscountApprovalRequests([row(A)], requests)).toEqual([tracked(second, { 0: A })]);
});
