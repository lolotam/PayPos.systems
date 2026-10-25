import { afterAll, beforeAll, expect, it } from 'vitest';
import type { AppendServiceSessionLinesInput, RecordServiceSessionInput } from '@pospay/contracts';
import { discountRequestFixture, ids, must, type DiscountRequestFixture } from './session.fixture.ts';
import {
  approvedProposal, consumedAudits, draftLine, lineRow, OCCURRED_AT, proposalRow, storageCounts,
} from './discount-consumption.helpers.ts';

let f: DiscountRequestFixture;
beforeAll(async () => { f = await discountRequestFixture(); });
afterAll(async () => { await f?.close(); });

type LineInput = AppendServiceSessionLinesInput['lines'][number];
const createInput = (lines: LineInput[]): RecordServiceSessionInput =>
  ({ customer_id: f.customer, occurred_at: OCCURRED_AT, lines });
const visit = async () => (await f.create.execute({ ...f.context(), input: createInput([f.line()]) })).session;
const append = (sessionId: string, lines: LineInput[], key = ids.newId()) =>
  f.append.execute({ ...f.context(key), sessionId, input: { lines } });
const approvedLine = (proposalId: string) => ({ ...draftLine(f), discount_proposal_id: proposalId });

it('DP-20 an append consumes the approval and keeps the recorder own limit columns', async () => {
  const session = await visit();
  const proposalId = await approvedProposal(f, { session_id: session.id });
  const result = await append(session.id, [approvedLine(proposalId)]);
  expect(result.outcome).toBe('COMPLETE');
  expect(result.added_lines[0]).toMatchObject({ discount_proposal_id: proposalId, limit_source: 'PERSON', limit_bps_applied: 1000, net: '20.000' });
  const row = await proposalRow(f, proposalId);
  expect(row?.['status']).toBe('CONSUMED');
  expect(row?.['consumed_line_id']).toBe(result.added_lines[0]?.id);
  expect((row?.['consumed_at'] as Date).toISOString()).toBe('2026-10-15T08:00:00.000Z');
  expect(row?.['session_id']).toBe(session.id);
  const stored = await lineRow(f, must(result.added_lines[0]).id);
  expect(stored?.['discount_proposal_id']).toBe(proposalId);
  expect(stored?.['limit_bps_applied']).toBe(1000);
});

it('DP-20 the append leaves one audit entry and the event shape unchanged', async () => {
  const session = await visit();
  const proposalId = await approvedProposal(f, { session_id: session.id });
  const result = await append(session.id, [approvedLine(proposalId)]);
  const audits = await consumedAudits(f, proposalId);
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({ entity: 'discount_proposal', entity_id: proposalId, action: 'discount_proposal.consumed' });
  const events = await f.h.owner`SELECT payload FROM outbox WHERE company_id=${f.company} AND aggregate_id=${session.id}
    AND event_type='ServiceSessionLinesAdded'`;
  expect(events).toHaveLength(1);
  const payload = must(events[0])['payload'] as { lines: Record<string, unknown>[] };
  expect(Object.keys(payload.lines[0] as object)).not.toContain('discount_proposal_id');
});

it('DP-22 an approval of another visit refuses the line as a mismatch', async () => {
  const session = await visit();
  const other = await visit();
  const proposalId = await approvedProposal(f, { session_id: session.id });
  const result = await append(other.id, [approvedLine(proposalId), f.line()]);
  expect(result.outcome).toBe('PARTIAL');
  expect(result.rejected_lines[0]).toMatchObject({ input_index: 0, approval_refusal: 'TERMS_MISMATCH', discount_proposal_id: proposalId });
  expect((await proposalRow(f, proposalId))?.['status']).toBe('APPROVED');
});

it('FR-020 the same approval twice in one append saves the first line and refuses the second', async () => {
  const session = await visit();
  const proposalId = await approvedProposal(f, { session_id: session.id });
  const result = await append(session.id, [approvedLine(proposalId), approvedLine(proposalId)]);
  expect(result.outcome).toBe('PARTIAL');
  expect(result.added_lines).toHaveLength(1);
  expect(result.rejected_lines[0]).toMatchObject({ input_index: 1, approval_refusal: 'CONSUMED', discount_proposal_id: proposalId });
  expect((await proposalRow(f, proposalId))?.['status']).toBe('CONSUMED');
});

it('DP-25 a line inside the raised limit saves on her own limit and leaves the approval alone', async () => {
  const session = await visit();
  const proposalId = await approvedProposal(f, { session_id: session.id });
  await f.h.owner`UPDATE memberships SET limit_bps=2000 WHERE company_id=${f.company} AND id=${f.membership}`;
  try {
    const result = await append(session.id, [approvedLine(proposalId)]);
    expect(result.outcome).toBe('COMPLETE');
    expect(result.added_lines[0]).toMatchObject({ limit_source: 'PERSON', limit_bps_applied: 2000 });
    expect(result.added_lines[0]?.discount_proposal_id).toBeUndefined();
    const row = await proposalRow(f, proposalId);
    expect(row?.['status']).toBe('APPROVED');
    expect(row?.['consumed_line_id']).toBeNull();
    expect(await consumedAudits(f, proposalId)).toHaveLength(0);
  } finally {
    await f.h.owner`UPDATE memberships SET limit_bps=1000 WHERE company_id=${f.company} AND id=${f.membership}`;
  }
});

it('DP-24 the replay of an append that consumed returns the first body and consumes nothing twice', async () => {
  const session = await visit();
  const proposalId = await approvedProposal(f, { session_id: session.id });
  const key = ids.newId();
  const lines = [approvedLine(proposalId)];
  const first = await append(session.id, lines, key);
  const counts = await storageCounts(f);
  expect(await append(session.id, lines, key)).toEqual(first);
  expect(await storageCounts(f)).toEqual(counts);
  const row = await proposalRow(f, proposalId);
  expect(row?.['status']).toBe('CONSUMED');
  expect(row?.['consumed_line_id']).toBe(first.added_lines[0]?.id);
});

it('DP-24 a new key with the same line finds the approval already consumed', async () => {
  const session = await visit();
  const proposalId = await approvedProposal(f, { session_id: session.id });
  await append(session.id, [approvedLine(proposalId)]);
  await expect(append(session.id, [approvedLine(proposalId)])).rejects.toMatchObject({
    code: 'SESSION_DISCOUNT_ABOVE_LIMIT',
    details: { rejected_lines: [{ approval_refusal: 'CONSUMED', discount_proposal_id: proposalId }] },
  });
});
