import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import type { RecordServiceSessionInput, RecordServiceSessionResponse } from '@pospay/contracts';
import { discountRequestFixture, ids, interceptDatabase, type DiscountRequestFixture } from './session.fixture.ts';
import { approvedProposal, draftLine, OCCURRED_AT, proposalRow } from './discount-consumption.helpers.ts';
import { ordersTransactions } from '../orders.module.ts';
import { createSessionRecovery } from '../persistence/session-recovery.adapter.ts';
import { AppendServiceSessionLinesUseCase } from '../use-cases/append-service-session-lines/append-service-session-lines.usecase.ts';
import { RecordServiceSessionUseCase } from '../use-cases/record-service-session/record-service-session.usecase.ts';

let f: DiscountRequestFixture;
beforeAll(async () => { f = await discountRequestFixture(); });
afterAll(async () => { await f?.close(); });

type LineInput = RecordServiceSessionInput['lines'][number];
const createInput = (lines: LineInput[]): RecordServiceSessionInput =>
  ({ customer_id: f.customer, occurred_at: OCCURRED_AT, lines });

function barrier() {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

/** موضع قفل الطلبات وموضع قراءة الحد في ترتيب الجمل الملتقطة. */
function orderOf(statements: readonly string[]): { proposal: number; limit: number } {
  return {
    proposal: statements.findIndex((statement) => statement.includes('discount_proposals')),
    limit: statements.findIndex((statement) => statement.includes('business_settings')),
  };
}

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

it('a limit change that commits while the approval lock waits is judged on the new limit', async () => {
  // The personal limit is cleared so the business default decides, and the default is raised so the line starts
  // inside the limit; the blocking transaction lowers it again while the writer waits on the approval lock.
  await f.h.owner`UPDATE memberships SET limit_bps=NULL WHERE company_id=${f.company} AND id=${f.membership}`;
  await f.h.owner`INSERT INTO business_settings (company_id, business_id, limit_bps)
    VALUES(${f.company},${f.business},1000) ON CONFLICT (company_id, business_id) DO UPDATE SET limit_bps=1000`;
  const proposalId = await approvedProposal(f, { occurred_at: OCCURRED_AT });
  await f.h.owner`UPDATE business_settings SET limit_bps=10000 WHERE company_id=${f.company} AND business_id=${f.business}`;
  const observer = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
  const locked = barrier();
  const release = barrier();
  const blocker = f.h.owner.begin(async (write) => {
    await write`SELECT id FROM discount_proposals WHERE company_id=${f.company} AND id=${proposalId} FOR UPDATE`;
    locked.release();
    await release.promise;
    await write`UPDATE business_settings SET limit_bps=1000 WHERE company_id=${f.company} AND business_id=${f.business}`;
  });
  let creating: Promise<RecordServiceSessionResponse> | undefined;
  try {
    await locked.promise;
    const pending = f.create.execute({ ...f.context(), input: createInput([{ ...draftLine(f), discount_proposal_id: proposalId }]) });
    pending.catch(() => undefined);
    creating = pending;
    await vi.waitFor(async () => {
      const waiting = await observer`SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
        AND wait_event_type='Lock' AND query LIKE '%discount_proposals%'`;
      expect(waiting.length).toBeGreaterThan(0);
    }, { timeout: 5000, interval: 20 });
    release.release();
    await blocker;
    const result = await pending;
    expect(result.outcome).toBe('COMPLETE');
    expect(result.session.lines[0]).toMatchObject({
      discount_proposal_id: proposalId, limit_source: 'BUSINESS', limit_bps_applied: 1000,
    });
    const row = await proposalRow(f, proposalId);
    expect(row?.['status']).toBe('CONSUMED');
    expect(row?.['consumed_line_id']).toBe(result.session.lines[0]?.id);
  } finally {
    release.release();
    await blocker;
    await creating?.catch(() => undefined);
    await observer.end();
    await f.h.owner`UPDATE memberships SET limit_bps=1000 WHERE company_id=${f.company} AND id=${f.membership}`;
    await f.h.owner`UPDATE business_settings SET limit_bps=1000 WHERE company_id=${f.company} AND business_id=${f.business}`;
  }
});

it('the approval lock is taken before the effective limit is read, on the create and on the append', async () => {
  const statements: string[] = [];
  const wrapped = interceptDatabase(f.db, async (statement) => { statements.push(statement); });
  const transactions = ordersTransactions(wrapped, ids, f.clock);
  const recovery = createSessionRecovery(f.db, ids, f.clock);
  const create = new RecordServiceSessionUseCase(transactions, recovery, ids, f.clock);
  const append = new AppendServiceSessionLinesUseCase(transactions, recovery, ids, f.clock);
  const proposalId = await approvedProposal(f, { occurred_at: OCCURRED_AT });
  statements.length = 0;
  await create.execute({ ...f.context(), input: createInput([{ ...draftLine(f), discount_proposal_id: proposalId }]) });
  const created = orderOf(statements);
  expect(created.proposal).toBeGreaterThanOrEqual(0);
  expect(created.limit).toBeGreaterThan(created.proposal);
  const session = await f.create.execute({ ...f.context(), input: createInput([f.line()]) });
  const appendProposal = await approvedProposal(f, { session_id: session.session.id });
  statements.length = 0;
  await append.execute({ ...f.context(ids.newId()), sessionId: session.session.id,
    input: { lines: [{ ...draftLine(f), discount_proposal_id: appendProposal }] } });
  const appended = orderOf(statements);
  expect(appended.proposal).toBeGreaterThanOrEqual(0);
  expect(appended.limit).toBeGreaterThan(appended.proposal);
});
