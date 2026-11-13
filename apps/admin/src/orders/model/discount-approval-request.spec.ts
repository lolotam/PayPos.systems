import type { RequestDiscountApprovalResponse } from '@pospay/contracts';
import { expect, it } from 'vitest';
import { buildDiscountApprovalBody, discountApprovalFingerprint, discountProposalLocalIds, refusedDiscountDrafts } from './discount-approval-request';
import { createSessionDraft, type SessionDraftForm, type SessionDraftLine } from './session-drafts';
import { emptySessionRecordingResult, type SessionRecordingResult } from './session-recording-result';
import { id, instant, rejection } from './session-recording-result.fixture';
import { sessionCommandLines } from './use-session-recording';

function draft(localId = id(10)): SessionDraftLine {
  return { ...createSessionDraft(localId), service_id: id(5), price: '7.125', discount_kind: 'PERCENT',
    discount_percentage: '10', performers: [{ employee_id: id(6), share_percentage: '', selection: null }] };
}

function setup(sessionId: string | null, lines = [draft()]) {
  const drafts: SessionDraftForm = { occurred_at: instant, recorder_membership_id: id(8), lines };
  const result: SessionRecordingResult = { ...emptySessionRecordingResult(), customerId: id(7), sessionId,
    rejected: [{ localId: lines[0]?.local_id ?? '', error: rejection }] };
  const rows = refusedDiscountDrafts(result, drafts.lines);
  return { body: buildDiscountApprovalBody(result, drafts, sessionCommandLines(rows)), drafts, rows };
}

it('builds a saved-visit body without occurred_at or a previous proposal id', () => {
  const line = draft();
  line.discount_proposal = { id: id(50), fingerprint: discountApprovalFingerprint(line) };
  const { body } = setup(id(12), [line]);
  expect(body).toEqual({ customer_id: id(7), session_id: id(12), requester_membership_id: id(8), lines: [{
    service_id: id(5), price: '7.125', discount: { kind: 'PERCENT', bps: 1000 }, performers: [{ employee_id: id(6) }],
  }] });
  expect(body).not.toHaveProperty('occurred_at');
});

it('builds a fresh-visit body with its customer and occurred_at', () => {
  const { body } = setup(null);
  expect(body).toMatchObject({ customer_id: id(7), occurred_at: instant });
  expect(body).not.toHaveProperty('session_id');
});

it('sends only refused paid rows', () => {
  const refused = draft(), ordinary = draft(id(11));
  const packageLine = { ...draft(id(12)), from_package: true, package_entitlement_id: id(40) };
  const { body } = setup(null, [refused, ordinary, packageLine]);
  expect(body.lines).toHaveLength(1);
  expect(body.lines[0]?.service_id).toBe(refused.service_id);
});

it('maps response input indexes to the sent local rows', () => {
  const rows = [draft(), draft(id(11))];
  const proposals = [1, 0].map((input_index) => ({ id: id(60 + input_index), input_index, status: 'PENDING',
    expires_at: instant, effective_bps: 1001, terms_hash: 'a'.repeat(64) })) as RequestDiscountApprovalResponse['proposals'];
  expect(discountProposalLocalIds(proposals, rows)).toEqual({ 0: id(10), 1: id(11) });
});

it('emits an approval only for unchanged terms and ignores share-only edits', () => {
  const line = draft();
  line.discount_proposal = { id: id(50), fingerprint: discountApprovalFingerprint(line) };
  expect(sessionCommandLines([line])[0]).toHaveProperty('discount_proposal_id', id(50));
  for (const changed of [{ price: '8.000' }, { discount_percentage: '11' }, { service_id: id(51) },
    { performers: [{ employee_id: id(52), share_percentage: '', selection: null }] }]) {
    expect(sessionCommandLines([{ ...line, ...changed }])[0]).not.toHaveProperty('discount_proposal_id');
  }
  const shared = { ...line, share_mode: 'CUSTOM' as const,
    performers: [{ employee_id: id(6), share_percentage: '100', selection: null }] };
  expect(sessionCommandLines([shared])[0]).toHaveProperty('discount_proposal_id', id(50));
});
