import { afterAll, beforeAll, expect, it } from 'vitest';
import type { RecordServiceSessionInput } from '@pospay/contracts';
import { discountRequestFixture, ids, type DiscountRequestFixture } from './session.fixture.ts';
import { approvedProposal, draftLine, OCCURRED_AT, proposalRow } from './discount-consumption.helpers.ts';

let f: DiscountRequestFixture;
beforeAll(async () => { f = await discountRequestFixture(); });
afterAll(async () => { await f?.close(); });

type LineInput = RecordServiceSessionInput['lines'][number];
const createInput = (lines: LineInput[]): RecordServiceSessionInput =>
  ({ customer_id: f.customer, occurred_at: OCCURRED_AT, lines });

it('DP-21 two concurrent creates with one approval leave one line, one consumption and one refusal', async () => {
  const proposalId = await approvedProposal(f);
  const lines: LineInput[] = [{ ...draftLine(f), discount_proposal_id: proposalId }, f.line()];
  const replies = await Promise.all([
    f.create.execute({ ...f.context(ids.newId()), input: createInput(lines) }),
    f.create.execute({ ...f.context(ids.newId()), input: createInput(lines) }),
  ]);
  expect(replies.map((reply) => reply.outcome).sort()).toEqual(['COMPLETE', 'PARTIAL']);
  const loser = replies.find((reply) => reply.outcome === 'PARTIAL');
  const winner = replies.find((reply) => reply.outcome === 'COMPLETE');
  expect(loser?.rejected_lines[0]).toMatchObject({ input_index: 0, approval_refusal: 'CONSUMED', discount_proposal_id: proposalId });
  expect(loser?.session.lines).toHaveLength(1);
  expect(loser?.session.lines[0]?.discount_proposal_id).toBeUndefined();
  expect(winner?.session.lines[0]).toMatchObject({ discount_proposal_id: proposalId });
  const row = await proposalRow(f, proposalId);
  expect(row?.['status']).toBe('CONSUMED');
  const consumed = await f.h.owner`SELECT id FROM service_lines WHERE company_id=${f.company} AND discount_proposal_id=${proposalId}`;
  expect(consumed).toHaveLength(1);
  expect(consumed[0]?.['id']).toBe(row?.['consumed_line_id']);
  const audits = await f.h.owner`SELECT entity_id FROM audit_log WHERE company_id=${f.company} AND action='discount_proposal.consumed'
    AND entity_id=${proposalId}`;
  expect(audits).toHaveLength(1);
});
