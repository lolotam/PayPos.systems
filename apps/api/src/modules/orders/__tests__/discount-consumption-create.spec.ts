import { afterAll, beforeAll, expect, it } from 'vitest';
import type { RecordServiceSessionInput } from '@pospay/contracts';
import { discountRequestFixture, ids, interceptDatabase, must, type DiscountRequestFixture } from './session.fixture.ts';
import {
  approvedProposal, consumedAudits, draftLine, lineRow, OCCURRED_AT, proposalRow, storageCounts,
} from './discount-consumption.helpers.ts';
import { ordersTransactions } from '../orders.module.ts';
import { createSessionRecovery } from '../persistence/session-recovery.adapter.ts';
import { RecordServiceSessionUseCase } from '../use-cases/record-service-session/record-service-session.usecase.ts';

let f: DiscountRequestFixture;
beforeAll(async () => { f = await discountRequestFixture(); });
afterAll(async () => { await f?.close(); });

type LineInput = RecordServiceSessionInput['lines'][number];
const createInput = (lines: LineInput[], over: { customer_id?: string; occurred_at?: string } = {}): RecordServiceSessionInput =>
  ({ customer_id: over.customer_id ?? f.customer, occurred_at: over.occurred_at ?? OCCURRED_AT, lines });
const create = (lines: LineInput[], over?: { customer_id?: string; occurred_at?: string }) =>
  f.create.execute({ ...f.context(), input: createInput(lines, over) });
const approvedLine = (proposalId: string) => ({ ...draftLine(f), discount_proposal_id: proposalId });

it('DP-20 a create consumes the approval in the line transaction and keeps the recorder own limit', async () => {
  const proposalId = await approvedProposal(f);
  const result = await create([approvedLine(proposalId)]);
  expect(result.outcome).toBe('COMPLETE');
  expect(result.session.lines[0]).toMatchObject({ discount_proposal_id: proposalId, limit_source: 'PERSON', limit_bps_applied: 1000, net: '20.000' });
  const row = await proposalRow(f, proposalId);
  expect(row?.['status']).toBe('CONSUMED');
  expect(row?.['consumed_line_id']).toBe(result.session.lines[0]?.id);
  expect((row?.['consumed_at'] as Date).toISOString()).toBe('2026-10-15T08:00:00.000Z');
  expect(row?.['session_id']).toBeNull();
  const stored = await lineRow(f, must(result.session.lines[0]).id);
  expect(stored?.['discount_proposal_id']).toBe(proposalId);
  expect(stored?.['limit_bps_applied']).toBe(1000);
});

it('DP-20 the consumption leaves one audit entry and the event shape unchanged', async () => {
  const proposalId = await approvedProposal(f);
  const result = await create([approvedLine(proposalId)]);
  const audits = await consumedAudits(f, proposalId);
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({ entity: 'discount_proposal', entity_id: proposalId, action: 'discount_proposal.consumed' });
  expect(JSON.stringify(audits[0])).not.toContain('phone');
  const events = await f.h.owner`SELECT payload FROM outbox WHERE company_id=${f.company} AND aggregate_id=${result.session.id}`;
  expect(events).toHaveLength(1);
  const payload = must(events[0])['payload'] as { lines: Record<string, unknown>[] };
  expect(Object.keys(payload.lines[0] as object)).not.toContain('discount_proposal_id');
});

it('DP-22 a changed discount, price, service, performer, customer or date refuses the line as a mismatch', async () => {
  const cases: [string, LineInput][] = [
    ['a bigger discount', f.draft(0, '25.000', '5.500', 1)],
    ['a smaller price', f.draft(0, '24.000', '5.000', 1)],
    ['another service', f.draft(1, '7.125', '1.712', 1)],
    ['another performer', f.draft(0, '25.000', '5.000', 2)],
  ];
  for (const [label, changed] of cases) {
    const proposalId = await approvedProposal(f);
    const result = await create([{ ...changed, discount_proposal_id: proposalId }, f.line()]);
    expect(result.outcome, label).toBe('PARTIAL');
    expect(result.rejected_lines[0], label).toMatchObject({ input_index: 0, approval_refusal: 'TERMS_MISMATCH', discount_proposal_id: proposalId });
    const row = await proposalRow(f, proposalId);
    expect(row?.['status'], label).toBe('APPROVED');
    expect(row?.['consumed_line_id'], label).toBeNull();
  }
});

it('DP-22 another customer or another business date refuses the line as a mismatch', async () => {
  const customerId = ids.newId();
  await f.h.owner`INSERT INTO customers(company_id,id,name,phone,locale,created_at,updated_at)
    VALUES(${f.company},${customerId},'Another customer','+999999998124','en',now(),now())`;
  const proposalId = await approvedProposal(f);
  const other = await create([{ ...draftLine(f), discount_proposal_id: proposalId }, f.line()], { customer_id: customerId });
  expect(other.rejected_lines[0]).toMatchObject({ approval_refusal: 'TERMS_MISMATCH' });
  const dated = await create([{ ...draftLine(f), discount_proposal_id: proposalId }, f.line()], { occurred_at: '2026-10-13T08:00:00.000Z' });
  expect(dated.rejected_lines[0]).toMatchObject({ approval_refusal: 'TERMS_MISMATCH' });
  expect((await proposalRow(f, proposalId))?.['status']).toBe('APPROVED');
});

it('FR-020 the same approval twice in one request saves the first line and refuses the second as consumed', async () => {
  const proposalId = await approvedProposal(f);
  const result = await create([approvedLine(proposalId), approvedLine(proposalId)]);
  expect(result.outcome).toBe('PARTIAL');
  expect(result.session.lines).toHaveLength(1);
  expect(result.session.lines[0]).toMatchObject({ discount_proposal_id: proposalId });
  expect(result.rejected_lines[0]).toMatchObject({ input_index: 1, approval_refusal: 'CONSUMED', discount_proposal_id: proposalId });
  expect((await proposalRow(f, proposalId))?.['status']).toBe('CONSUMED');
});

it('DP-25 a line inside the raised limit saves on her own limit and leaves the approval alone', async () => {
  const proposalId = await approvedProposal(f);
  await f.h.owner`UPDATE memberships SET limit_bps=2000 WHERE company_id=${f.company} AND id=${f.membership}`;
  try {
    const result = await create([approvedLine(proposalId)]);
    expect(result.outcome).toBe('COMPLETE');
    expect(result.session.lines[0]).toMatchObject({ limit_source: 'PERSON', limit_bps_applied: 2000 });
    expect(result.session.lines[0]?.discount_proposal_id).toBeUndefined();
    const row = await proposalRow(f, proposalId);
    expect(row?.['status']).toBe('APPROVED');
    expect(row?.['consumed_line_id']).toBeNull();
    expect(await consumedAudits(f, proposalId)).toHaveLength(0);
  } finally {
    await f.h.owner`UPDATE memberships SET limit_bps=1000 WHERE company_id=${f.company} AND id=${f.membership}`;
  }
});

it('DP-24 the replay returns the first body and consumes nothing twice', async () => {
  const proposalId = await approvedProposal(f);
  const key = ids.newId();
  const input = createInput([approvedLine(proposalId)]);
  const first = await f.create.execute({ ...f.context(key), input });
  const counts = await storageCounts(f);
  const replay = await f.create.execute({ ...f.context(key), input });
  expect(replay).toEqual(first);
  expect(await storageCounts(f)).toEqual(counts);
  const row = await proposalRow(f, proposalId);
  expect(row?.['status']).toBe('CONSUMED');
  expect(row?.['consumed_line_id']).toBe(first.session.lines[0]?.id);
});

it('DP-24 a new key with the same line finds the approval already consumed', async () => {
  const proposalId = await approvedProposal(f);
  const input = createInput([approvedLine(proposalId)]);
  await f.create.execute({ ...f.context(), input });
  await expect(f.create.execute({ ...f.context(), input })).rejects.toMatchObject({
    code: 'SESSION_DISCOUNT_ABOVE_LIMIT',
    details: { rejected_lines: [{ approval_refusal: 'CONSUMED', discount_proposal_id: proposalId }] },
  });
});

it('a failure after the consumption rolls the line, the visit, the claim and the consumption back', async () => {
  const proposalId = await approvedProposal(f);
  const before = await storageCounts(f);
  const wrapped = interceptDatabase(f.db, async (statement) => {
    if (/INSERT INTO audit_log/.test(statement)) throw new Error('Synthetic driver failure');
  });
  const create = new RecordServiceSessionUseCase(ordersTransactions(wrapped, ids, f.clock), createSessionRecovery(f.db, ids, f.clock), ids, f.clock);
  const key = ids.newId();
  await expect(create.execute({ ...f.context(key), input: createInput([approvedLine(proposalId)]) }))
    .rejects.toThrow('SESSION_PERSISTENCE_FAILED');
  expect(await storageCounts(f)).toEqual(before);
  const row = await proposalRow(f, proposalId);
  expect(row?.['status']).toBe('APPROVED');
  expect(row?.['consumed_line_id']).toBeNull();
  expect(await consumedAudits(f, proposalId)).toHaveLength(0);
});

it('a request with no approval id never touches the proposals table', async () => {
  const statements: string[] = [];
  const wrapped = interceptDatabase(f.db, async (statement) => { statements.push(statement); });
  const create = new RecordServiceSessionUseCase(ordersTransactions(wrapped, ids, f.clock), createSessionRecovery(f.db, ids, f.clock), ids, f.clock);
  await create.execute({ ...f.context(), input: createInput([f.line()]) });
  expect(statements.some((statement) => statement.includes('discount_proposals'))).toBe(false);
});
