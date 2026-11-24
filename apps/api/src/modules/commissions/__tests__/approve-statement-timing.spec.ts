import { appendFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asReplicaOwner } from '../../../../../../packages/db/test/owner-cleanup.ts';
import {
  approve,
  approverMember,
  issueProof,
  openSwitch,
  resetStatementToDraft,
  reviewedStatement,
  type Approver,
} from './approve-statement.fixture.ts';
import {
  generateStatement,
  statementFixture,
  type StatementFixture,
} from './commission-statement.fixture.ts';

// #1223 (بند التوقيت الملزم): كلفة العدّاد والاعتماد الكامل على تاريخ كبير مستهلك بالكامل مع حدث معلّق واحد، بحدّ
// الاعتماد الحقيقي transaction_timestamp(). لا اعتماد على تطهير مستقبلي. حد الـ 200 ms مطلق على دالة العدّ (CLAUDE.md §6)؛
// الاعتماد الكامل يُقارن بنفس الجولة بنقطة generate المدموجة على نفس الـfixture (PP-165)، بلا حد ملّي ثابت على الطلب كله،
// والسؤال المطلق عليه يُجاب على سيرفر staging قبل تفعيل الاعتماد لأي شركة (وصف PR A، قسم «قبل تفعيل الاعتماد»).
const HISTORY = 30_000;
const COUNT_SIZES = [0, HISTORY];
const COUNT_RUNS = 9;
const APPROVAL_RUNS = 5;
const COUNT_BUDGET_MS = 200;
const RATIO_LIMIT = 2;
const RATIO_FLOOR_MS = 50;
const APPROVAL_TEST_TIMEOUT_MS = 300_000;
const TYPES = [
  'ServiceSessionRecorded',
  'ServiceSessionLinesAdded',
  'ServiceLineChanged',
  'SessionTipsChanged',
  'SalaryChanged',
  'PackageSaleChanged',
];

let f: StatementFixture;
let approver: Approver;

beforeAll(async () => {
  f = await statementFixture();
  approver = await approverMember(f, 'timing-approver');
});

afterAll(async () => {
  await f?.h.close();
});

const median = (values: number[]): number =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? Number.NaN;

/** يكتب أرقام الجولة لملف اختياري يحدده المنفّذ، لأن مخرجات console للاختبار الناجح لا تظهر في تقرير vitest. */
function record(entry: Record<string, unknown>): void {
  const path = process.env['TIMING_REPORT_FILE'];
  if (path !== undefined) appendFileSync(path, `${JSON.stringify(entry)}\n`);
}

/** يزرع تاريخًا مستهلكًا بالكامل: صف outbox وعلامة استهلاك لكل حدث، ثم ANALYZE كما في القياس المحلي لـ PR #1233. */
async function seedConsumedHistory(count: number): Promise<void> {
  await asReplicaOwner(f.h.owner, (tx) => tx`DELETE FROM outbox WHERE company_id = ${f.company}`);
  await f.h.owner`DELETE FROM consumed_events WHERE company_id = ${f.company}`;
  if (count > 0) {
    await f.h.owner`INSERT INTO outbox (company_id, id, aggregate_type, aggregate_id, event_type, payload,
        created_at, published_at, attempts, next_attempt_at)
      SELECT ${f.company}, ('01970000-0000-7000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, 'service_session',
        ('01970000-0000-7000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, (${TYPES}::text[])[1 + g % 6], '{}'::jsonb,
        now() - interval '2 days', now() - interval '2 days', 0, now()
      FROM generate_series(1, ${count}) AS g`;
    await f.h.owner`INSERT INTO consumed_events (company_id, consumer_id, event_id)
      SELECT company_id, 'commissions.project-inputs', id FROM outbox WHERE company_id = ${f.company}`;
  }
  await f.h.owner.unsafe('ANALYZE outbox');
  await f.h.owner.unsafe('ANALYZE consumed_events');
}

/** زمن تنفيذ الدالة بحدّ حقيقي، بدور التطبيق وسياق الشركة (كما تنفذها معاملة الاعتماد). */
async function countDurationMs(): Promise<number> {
  const [row] = await f.h.owner.begin(async (tx) => {
    await tx`SET LOCAL ROLE pospay_app`;
    await tx`SELECT set_config('app.company_id', ${f.company}, true)`;
    const [clock] = await tx`SELECT transaction_timestamp()::text AS cutoff`;
    const started = performance.now();
    await tx`SELECT public.statement_pending_commission_events(${clock?.['cutoff'] as string}::text::timestamptz)`;
    return [{ ms: performance.now() - started }];
  });
  return row?.['ms'] as number;
}

describe('the pending count on a fully consumed history (#1223)', () => {
  it.each(COUNT_SIZES)('stays under the 200 ms rule with %i retained events and one pending event', async (size) => {
    await seedConsumedHistory(size);
    await f.h.owner`INSERT INTO outbox (company_id, id, aggregate_type, aggregate_id, event_type, payload,
      created_at, attempts, next_attempt_at)
      VALUES (${f.company}, '01970000-0000-7000-8000-0000ffffff01', 'service_session',
        '01970000-0000-7000-8000-0000ffffff01', 'SalaryChanged', '{}'::jsonb, now() - interval '1 day', 0, now())`;
    const runs: number[] = [];
    for (let run = 0; run < COUNT_RUNS; run += 1) runs.push(await countDurationMs());

    const medianMs = median(runs);
    record({ measure: 'pending-count', events: size, medianMs, maxMs: Math.max(...runs) });
    expect(medianMs).toBeLessThan(COUNT_BUDGET_MS);
  });
});

describe('the whole approval against the merged generate on the same fixture (#1223, PP-165)', () => {
  it('costs at most twice generate plus a small floor, over a large consumed history', async () => {
    await seedConsumedHistory(HISTORY);
    const generates: number[] = [];
    const approvals: number[] = [];
    for (let run = 0; run < APPROVAL_RUNS; run += 1) {
      await resetStatementToDraft(f);
      await asReplicaOwner(f.h.owner, async (tx) => {
        await tx`DELETE FROM commission_coverage_proofs WHERE company_id = ${f.company}`;
        await tx`DELETE FROM commission_coverage_state WHERE company_id = ${f.company}`;
      });
      const generateStarted = performance.now();
      await generateStatement(f, f.cookie, `timing-generate-${run}`);
      generates.push(performance.now() - generateStarted);
      const fingerprints = await reviewedStatement(f, approver);
      await openSwitch(f, approver.userId);
      await issueProof(f);

      const started = performance.now();
      const response = await approve(f, approver.cookie, `timing-approve-${run}`, fingerprints);
      approvals.push(performance.now() - started);
      expect(response.status).toBe(200);
    }

    const generateMs = median(generates);
    const approvalMs = median(approvals);
    record({ measure: 'approval-vs-generate', events: HISTORY, generateMs, approvalMs, ratio: approvalMs / generateMs });
    expect(approvalMs).toBeLessThanOrEqual(RATIO_LIMIT * generateMs + RATIO_FLOOR_MS);
  }, APPROVAL_TEST_TIMEOUT_MS);
});
