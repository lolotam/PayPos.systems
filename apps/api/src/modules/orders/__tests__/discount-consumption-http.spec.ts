import { afterAll, beforeAll, expect, it } from 'vitest';
import { appendServiceSessionLinesResponse, rejectedServiceLine, recordServiceSessionResponse } from '@pospay/contracts';
import { AT, discountRequestFixture, ids, must, type DiscountRequestFixture } from './session.fixture.ts';
import { approvedProposal, draftLine, pendingProposal, proposalRow } from './discount-consumption.helpers.ts';

let f: DiscountRequestFixture;
beforeAll(async () => { f = await discountRequestFixture({ ordersClock: { now: () => AT } }); });
afterAll(async () => { await f?.close(); });

const append = (sessionId: string, lines: object[], key = ids.newId()) =>
  f.h.send('POST', `${f.base}/${sessionId}/lines`, { cookie: f.cookie, company: f.company, key, body: { lines } });

/** زيارة محفوظة عبر المسار الحقيقي، فالإضافة تقرأ منها التاريخ والعميلة. */
async function savedVisit(): Promise<string> {
  const reply = await f.h.send('POST', f.base, { cookie: f.cookie, company: f.company, key: ids.newId(),
    body: { customer_id: f.customer, occurred_at: '2026-10-14T08:00:00.000Z', lines: [f.line()] } });
  expect(reply.status).toBe(201);
  return recordServiceSessionResponse.parse(reply.body).session.id;
}

it('the append route consumes an approved proposal and returns the line with its proposal id', async () => {
  const sessionId = await savedVisit();
  const proposalId = await approvedProposal(f, { session_id: sessionId });
  const reply = await append(sessionId, [{ ...draftLine(f), discount_proposal_id: proposalId }]);
  expect(reply.status).toBe(201);
  const parsed = appendServiceSessionLinesResponse.parse(reply.body);
  expect(parsed.outcome).toBe('COMPLETE');
  expect(parsed.added_lines[0]?.discount_proposal_id).toBe(proposalId);
  expect(parsed.rejected_lines).toEqual([]);
  const row = await proposalRow(f, proposalId);
  expect(row?.['status']).toBe('CONSUMED');
  expect(row?.['consumed_line_id']).toBe(parsed.added_lines[0]?.id);
});

it('a pending proposal refuses its own line and the ordinary line still saves', async () => {
  const sessionId = await savedVisit();
  const proposalId = await pendingProposal(f, { session_id: sessionId });
  const reply = await append(sessionId, [{ ...draftLine(f), discount_proposal_id: proposalId }, f.line()]);
  expect(reply.status).toBe(201);
  const parsed = appendServiceSessionLinesResponse.parse(reply.body);
  expect(parsed.outcome).toBe('PARTIAL');
  expect(parsed.added_lines).toHaveLength(1);
  expect(parsed.added_lines[0]?.discount_proposal_id).toBeUndefined();
  const rejected = rejectedServiceLine.parse(must(parsed.rejected_lines[0]));
  expect(rejected.approval_refusal).toBe('NOT_APPROVED');
  expect(rejected.discount_proposal_id).toBe(proposalId);
  expect((await proposalRow(f, proposalId))?.['status']).toBe('PENDING');
});

it('the refused line alone fails the request with the refusal inside the error details', async () => {
  const sessionId = await savedVisit();
  const proposalId = await pendingProposal(f, { session_id: sessionId });
  const reply = await append(sessionId, [{ ...draftLine(f), discount_proposal_id: proposalId }]);
  expect(reply.status).toBe(422);
  expect(reply.body['code']).toBe('SESSION_DISCOUNT_ABOVE_LIMIT');
  const details = reply.body['details'] as { rejected_lines: { approval_refusal?: string; discount_proposal_id?: string }[] };
  expect(details.rejected_lines[0]?.approval_refusal).toBe('NOT_APPROVED');
  expect(details.rejected_lines[0]?.discount_proposal_id).toBe(proposalId);
  expect((await proposalRow(f, proposalId))?.['status']).toBe('PENDING');
});
