import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asReplicaOwner } from '../../../../../../packages/db/test/owner-cleanup.ts';
import {
  approvalFootprint,
  approve,
  approverMember,
  issueProof,
  openSwitch,
  reviewedStatement,
  type Approver,
} from './approve-statement.fixture.ts';
import { statementFixture, type StatementFixture } from './commission-statement.fixture.ts';

// #1223 (بند التوقيت الملزم): كلفة العدّاد والاعتماد الكامل على تاريخ كبير مستهلك بالكامل مع حدث معلّق واحد، بحدّ
// الاعتماد الحقيقي transaction_timestamp(). لا اعتماد على تطهير مستقبلي. حد الـ 200 ms مطلق (CLAUDE.md §6)؛ المقارنة بين
// حجمين تُطبع فقط، فلا يوجد كود قديم مقارَن به (PP-165).
const SIZES = [2_000, 30_000];
const RUNS = 7;
const BUDGET_MS = 200;
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

/** يزرع تاريخًا مستهلكًا بالكامل: صف outbox وعلامة استهلاك لكل حدث، ثم ANALYZE كما في القياس المحلي لـ PR #1233. */
async function seedConsumedHistory(count: number): Promise<void> {
  await asReplicaOwner(f.h.owner, (tx) => tx`DELETE FROM outbox WHERE company_id = ${f.company}`);
  await f.h.owner`DELETE FROM consumed_events WHERE company_id = ${f.company}`;
  await f.h.owner`INSERT INTO outbox (company_id, id, aggregate_type, aggregate_id, event_type, payload,
      created_at, published_at, attempts, next_attempt_at)
    SELECT ${f.company}, ('01970000-0000-7000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, 'service_session',
      ('01970000-0000-7000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, (${TYPES}::text[])[1 + g % 6], '{}'::jsonb,
      now() - interval '2 days', now() - interval '2 days', 0, now()
    FROM generate_series(1, ${count}) AS g`;
  await f.h.owner`INSERT INTO consumed_events (company_id, consumer_id, event_id)
    SELECT company_id, 'commissions.project-inputs', id FROM outbox WHERE company_id = ${f.company}`;
  await f.h.owner.unsafe('ANALYZE outbox');
  await f.h.owner.unsafe('ANALYZE consumed_events');
}

/** وسيط أزمنة تنفيذ الدالة بحدّ حقيقي، بدور التطبيق وسياق الشركة (كما تنفذها معاملة الاعتماد). */
async function medianCountMs(): Promise<number> {
  const times: number[] = [];
  for (let run = 0; run < RUNS; run += 1) {
    const [row] = await f.h.owner.begin(async (tx) => {
      await tx`SET LOCAL ROLE pospay_app`;
      await tx`SELECT set_config('app.company_id', ${f.company}, true)`;
      const [clock] = await tx`SELECT transaction_timestamp()::text AS cutoff`;
      const started = performance.now();
      await tx`SELECT public.statement_pending_commission_events(${clock?.['cutoff'] as string}::text::timestamptz)`;
      return [{ ms: performance.now() - started }];
    });
    times.push(row?.['ms'] as number);
  }
  return [...times].sort((a, b) => a - b)[Math.floor(RUNS / 2)] ?? Number.NaN;
}

describe('the pending count on a fully consumed history (#1223)', () => {
  const medians: Record<number, number> = {};

  it.each(SIZES)('stays under the 200 ms rule with %i retained events and one pending event', async (size) => {
    await seedConsumedHistory(size);
    await f.h.owner`INSERT INTO outbox (company_id, id, aggregate_type, aggregate_id, event_type, payload,
      created_at, attempts, next_attempt_at)
      VALUES (${f.company}, '01970000-0000-7000-8000-0000ffffff01', 'service_session',
        '01970000-0000-7000-8000-0000ffffff01', 'SalaryChanged', '{}'::jsonb, now() - interval '1 day', 0, now())`;

    medians[size] = await medianCountMs();

    console.info('pending count timing', { events: size, runs: RUNS, medianMs: medians[size] });
    expect(medians[size]).toBeLessThan(BUDGET_MS);
  });

  it('reports how the cost follows the retained history, for the record', () => {
    const [small, large] = SIZES;
    const ratio = (medians[large as number] ?? 0) / Math.max(medians[small as number] ?? 1, 0.01);
    console.info('pending count cost ratio', { small, large, ratio });
    expect(Number.isFinite(ratio)).toBe(true);
  });
});

describe('the whole approval on that history (#1223)', () => {
  it('approves within the 200 ms rule on a large consumed history, with the real cutoff', async () => {
    await seedConsumedHistory(SIZES[SIZES.length - 1] ?? 30_000);
    const fingerprints = await reviewedStatement(f, approver);
    await openSwitch(f, approver.userId);
    await issueProof(f);
    await approve(f, approver.cookie, 'timing-warmup', fingerprints, '2026-10').catch(() => undefined);

    const started = performance.now();
    const response = await approve(f, approver.cookie, 'timing-approve', fingerprints);
    const elapsed = performance.now() - started;

    console.info('full approval timing', { events: SIZES[SIZES.length - 1], elapsedMs: elapsed });
    expect(response.status).toBe(200);
    expect((await approvalFootprint(f)).status).toBe('APPROVED');
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});
