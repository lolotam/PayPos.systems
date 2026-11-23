import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  approvalFootprint,
  approve,
  approverMember,
  issueProof,
  openSwitch,
  reviewedStatement,
  type Approver,
} from './approve-statement.fixture.ts';
import { ids, PERIOD, statementFixture, type StatementFixture } from './commission-statement.fixture.ts';

// CM-37 (spec 059 §7): مُعتمِدان لنفس الشهر في وقت واحد. الحاجز قفل صف على الكشف يمسكه اتصال مستقل، فالطلبان يبدآن
// فعلًا ويقفان على قفل الشهر (يُرصدان في pg_stat_activity بميزانية محدودة، بلا نوم ثابت)، ثم يُفرَج عن القفل: واحد
// يجمّد والتاني يجد الشهر معتمدًا ويرفض بـ COMMISSION_PERIOD_CLOSED، والصفوف المجمّدة والمرحّل والتدقيق مرة واحدة.
const WAITERS_BUDGET_MS = 15_000;
const COLLECT_BUDGET_MS = 30_000;
const TEST_TIMEOUT_MS = 120_000;
const POLL_MS = 25;
const OCTOBER = '2026-10';

let f: StatementFixture;
let first: Approver;
let second: Approver;
let barrier: postgres.Sql;

beforeAll(async () => {
  f = await statementFixture();
  first = await approverMember(f, 'first-approver');
  second = await approverMember(f, 'second-approver');
  barrier = postgres(f.h.urls.owner, { max: 3, onnotice: () => undefined });
});

afterAll(async () => {
  await barrier?.end();
  await f?.h.close();
});

/** كشف أكتوبر وكشف نوفمبر DRAFT ومرحّل وارد سالب كبير لموظفة، فرصيدها في نوفمبر سالب ويُرحَّل مرة واحدة عند الاعتماد. */
async function seedNegativeIncomingCarry(): Promise<void> {
  const october = ids.newId();
  const november = ids.newId();
  await f.h.owner`INSERT INTO commission_statements (company_id, id, business_id, period, status)
    VALUES (${f.company}, ${october}, ${f.business}, ${OCTOBER}, 'DRAFT'),
           (${f.company}, ${november}, ${f.business}, ${PERIOD}, 'DRAFT')`;
  await f.h.owner`INSERT INTO commission_carries (company_id, id, business_id, employee_id, kind, amount,
      source_statement_id, source_period, target_period, target_statement_id)
    VALUES (${f.company}, ${ids.newId()}, ${f.business}, ${f.employee}, 'COMMISSION', -99999.000,
      ${october}, ${OCTOBER}, ${PERIOD}, ${november})`;
}

/** يحتفظ بقفل صف الكشف إلى أن يُستدعى release، ويرجع بعد أن أُخذ القفل فعلًا. */
async function holdStatementLock(): Promise<{ release: () => void; done: Promise<unknown> }> {
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let locked: () => void = () => undefined;
  const lockTaken = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const done = barrier.begin(async (tx) => {
    await tx`SELECT id FROM commission_statements
      WHERE company_id = ${f.company} AND business_id = ${f.business} AND period = ${PERIOD} FOR UPDATE`;
    locked();
    await released;
  });
  done.catch(() => undefined);
  await lockTaken;
  return { release, done };
}

/** ينتظر حتى يقف على قفل الصف عدد من الاتصالات، أو يفشل عند انتهاء الميزانية. */
async function waitForWaiters(count: number): Promise<void> {
  const deadline = performance.now() + WAITERS_BUDGET_MS;
  while (performance.now() < deadline) {
    const [row] = await barrier`SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`;
    if ((row?.['waiting'] as number) >= count) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`fewer than ${count} requests reached the statement lock within ${WAITERS_BUDGET_MS} ms`);
}

/** يجمع نتيجتي الطلبين بميزانية محدودة. */
function collect<T>(promises: Promise<T>[]): Promise<T[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('the two approvals did not settle in time')), COLLECT_BUDGET_MS);
  });
  return Promise.race([Promise.all(promises), expired]).finally(() => clearTimeout(timer));
}

describe('two approvers of the same month at once (CM-37)', () => {
  it('freezes once: one wins, the other gets 409 COMMISSION_PERIOD_CLOSED, and lines, carry and audit exist once', async () => {
    await seedNegativeIncomingCarry();
    const fingerprints = await reviewedStatement(f, first);
    await openSwitch(f, first.userId);
    await issueProof(f);
    const lock = await holdStatementLock();

    const requestA = approve(f, first.cookie, 'cm37-a', fingerprints);
    const requestB = approve(f, second.cookie, 'cm37-b', fingerprints);
    await waitForWaiters(2);
    lock.release();
    await lock.done;
    const responses = await collect([requestA, requestB]);

    const outcomes = responses.map((response) => [
      response.status,
      (response.body as { code?: string }).code ?? null,
    ]);
    expect(outcomes.filter(([status]) => status === 200)).toHaveLength(1);
    expect(outcomes.filter(([status, code]) => status === 409 && code === 'COMMISSION_PERIOD_CLOSED')).toHaveLength(1);
    const footprint = await approvalFootprint(f);
    expect(footprint.status).toBe('APPROVED');
    expect(footprint.audits).toBe(1);
    expect(footprint.carries).toBe(1);
    const [lines] = await f.h.owner`SELECT count(*)::int AS total,
        count(DISTINCT (employee_id, source_ref))::int AS distinct_rows
      FROM commission_statement_lines l JOIN commission_statements s ON s.id = l.statement_id
      WHERE s.company_id = ${f.company} AND s.period = ${PERIOD}`;
    expect(lines?.['total']).toBeGreaterThan(0);
    expect(lines?.['total']).toBe(lines?.['distinct_rows']);
  }, TEST_TIMEOUT_MS);
});
