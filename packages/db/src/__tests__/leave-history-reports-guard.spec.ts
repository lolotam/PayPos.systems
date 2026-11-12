import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  insertLeaveReport,
  insertLeaveReportRow,
  type LeaveReportTenant,
} from '../../test/leave-history-report-fixture.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let app: postgres.Sql;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 2, onnotice: () => undefined });
  await owner`INSERT INTO "user"(id, name, email, email_verified, created_at, updated_at)
    VALUES (${USER}, 'Guard test user', 'guard-spec@example.test', true, now(), now())
    ON CONFLICT DO NOTHING`;
  app = postgres(testDb.appUrl, { max: 4, onnotice: () => undefined });
});

afterAll(async () => {
  await app?.end();
  await owner?.end();
  await testDb?.drop();
});

async function asApp<T>(
  work: (tx: postgres.TransactionSql) => Promise<T>,
  tenant: LeaveReportTenant = TENANT.A,
) {
  return app.begin(async (tx) => {
    await tx`SELECT set_config('app.company_id', ${tenant.company}, true), set_config('app.user_id', ${USER}, true)`;
    return work(tx);
  });
}

it.each([
  ['ready', { status: 'ready', computed_at: new Date() }],
  ['failed', { status: 'failed', error_code: 'LEAVE_HISTORY_REPORT_FAILED' }],
  ['row_count > 0', { row_count: 5 }],
  ['error_code set', { error_code: 'LEAVE_HISTORY_REPORT_FAILED' }],
  ['computed_at set', { computed_at: new Date() }],
])('insert with %s is refused with LEAVE_HISTORY_REPORT_INITIAL_STATE_INVALID', async (_name, overrides) => {
  await expect(asApp((tx) => insertLeaveReport(tx, overrides))).rejects.toMatchObject({
    code: '23514',
    message: expect.stringContaining('LEAVE_HISTORY_REPORT_INITIAL_STATE_INVALID'),
  });
});

it('legal transition pending -> ready requires matching row_count', async () => {
  const rId = await asApp((tx) => insertLeaveReport(tx));
  await asApp((tx) => insertLeaveReportRow(tx, rId, 1));
  await asApp((tx) => insertLeaveReportRow(tx, rId, 2));

  await expect(
    asApp((tx) =>
      tx`UPDATE leave_history_reports
         SET status = 'ready', row_count = 1, computed_at = now()
         WHERE id = ${rId}`,
    ),
  ).rejects.toMatchObject({
    code: '23514',
    message: expect.stringContaining('LEAVE_HISTORY_REPORT_ROW_COUNT_MISMATCH'),
  });

  const updated = await asApp((tx) =>
    tx`UPDATE leave_history_reports
       SET status = 'ready', row_count = 2, computed_at = now()
       WHERE id = ${rId}
       RETURNING id, status, row_count`,
  );
  expect(updated).toEqual([{ id: rId, status: 'ready', row_count: 2 }]);
});

it('legal transition pending -> failed is refused when rows exist', async () => {
  const rId = await asApp((tx) => insertLeaveReport(tx));
  await asApp((tx) => insertLeaveReportRow(tx, rId, 1));

  await expect(
    asApp((tx) =>
      tx`UPDATE leave_history_reports
         SET status = 'failed', error_code = 'LEAVE_HISTORY_REPORT_FAILED', row_count = 0
         WHERE id = ${rId}`,
    ),
  ).rejects.toMatchObject({
    code: '23514',
    message: expect.stringContaining('LEAVE_HISTORY_REPORT_FAILED_HAS_ROWS'),
  });
});

it('pending -> failed with computed_at set is refused', async () => {
  const rId = await asApp((tx) => insertLeaveReport(tx));
  await expect(
    asApp(
      (tx) =>
        tx`UPDATE leave_history_reports
           SET status = 'failed', error_code = 'LEAVE_HISTORY_REPORT_FAILED', row_count = 0, computed_at = now()
           WHERE id = ${rId}`,
    ),
  ).rejects.toMatchObject({
    code: '23514',
    message: expect.stringContaining('LEAVE_HISTORY_REPORT_FAILED_HAS_ROWS'),
  });
});

it('legal transition pending -> failed succeeds when zero rows exist', async () => {
  const rId = await asApp((tx) => insertLeaveReport(tx));
  const updated = await asApp((tx) =>
    tx`UPDATE leave_history_reports
       SET status = 'failed', error_code = 'LEAVE_HISTORY_REPORT_FAILED', row_count = 0
       WHERE id = ${rId}
       RETURNING id, status, error_code`,
  );
  expect(updated).toEqual([{ id: rId, status: 'failed', error_code: 'LEAVE_HISTORY_REPORT_FAILED' }]);
});

it('ready and failed reports are immutable to further transitions', async () => {
  const readyId = await asApp((tx) => insertLeaveReport(tx));
  await asApp((tx) =>
    tx`UPDATE leave_history_reports
       SET status = 'ready', row_count = 0, computed_at = now()
       WHERE id = ${readyId}`,
  );

  await expect(
    asApp((tx) =>
      tx`UPDATE leave_history_reports
         SET status = 'failed', error_code = 'LEAVE_HISTORY_REPORT_FAILED'
         WHERE id = ${readyId}`,
    ),
  ).rejects.toMatchObject({
    code: '23514',
    message: expect.stringContaining('LEAVE_HISTORY_REPORT_TRANSITION_INVALID'),
  });

  const failedId = await asApp((tx) => insertLeaveReport(tx));
  await asApp((tx) =>
    tx`UPDATE leave_history_reports
       SET status = 'failed', error_code = 'LEAVE_HISTORY_REPORT_FAILED', row_count = 0
       WHERE id = ${failedId}`,
  );

  await expect(
    asApp((tx) =>
      tx`UPDATE leave_history_reports
         SET status = 'ready', row_count = 0, computed_at = now()
         WHERE id = ${failedId}`,
    ),
  ).rejects.toMatchObject({
    code: '23514',
    message: expect.stringContaining('LEAVE_HISTORY_REPORT_TRANSITION_INVALID'),
  });
});

it('immutable body: update of report metadata is refused by guard trigger', async () => {
  const rId = await asApp((tx) => insertLeaveReport(tx));
  await expect(
    owner`UPDATE leave_history_reports
          SET status = 'failed', error_code = 'LEAVE_HISTORY_REPORT_FAILED',
              as_of = now() + interval '1 hour'
          WHERE id = ${rId}`,
  ).rejects.toMatchObject({
    code: '23514',
    message: expect.stringContaining('LEAVE_HISTORY_REPORT_BODY_IMMUTABLE'),
  });
});

it('row insert is refused unless parent report is found and pending', async () => {
  const readyId = await asApp((tx) => insertLeaveReport(tx));
  await asApp((tx) =>
    tx`UPDATE leave_history_reports
       SET status = 'ready', row_count = 0, computed_at = now()
       WHERE id = ${readyId}`,
  );

  await expect(asApp((tx) => insertLeaveReportRow(tx, readyId, 1))).rejects.toMatchObject({
    code: '23514',
    message: expect.stringContaining('LEAVE_HISTORY_REPORT_NOT_PENDING'),
  });

  const missingId = randomUUID();
  await expect(asApp((tx) => insertLeaveReportRow(tx, missingId, 1))).rejects.toMatchObject({
    code: '23514',
    message: expect.stringContaining('LEAVE_HISTORY_REPORT_NOT_PENDING'),
  });
});

it.each([
  // CHECKs بتتفحص بالترتيب الأبجدي؛ حالة غير معروفة بترفضها shape_check قبل status_check، والاتنين بيرفضوها.
  ['invalid status', { status: 'in_progress' }, 'leave_history_reports_shape_check'],
  [
    'failed with computed_at',
    { status: 'failed', error_code: 'LEAVE_HISTORY_REPORT_FAILED', computed_at: new Date('2026-11-12T10:01:00Z') },
    'leave_history_reports_shape_check',
  ],
  ['negative row_count', { row_count: -1 }, 'leave_history_reports_row_count_check'],
  ['row_count > 25000', { row_count: 25001 }, 'leave_history_reports_row_count_check'],
  ['invalid fingerprint', { fingerprint: 'not-hex' }, 'leave_history_reports_fingerprint_check'],
  ['invalid error_code', { error_code: 'UNKNOWN_CODE' }, 'leave_history_reports_error_code_check'],
  ['deadline_at <= as_of', { deadline_at: new Date('2026-11-12T09:00:00Z') }, 'leave_history_reports_deadline_at_check'],
  ['expires_at <= as_of', { expires_at: new Date('2026-11-12T09:00:00Z') }, 'leave_history_reports_expires_at_check'],
])('CHECK constraint %s is enforced', async (_label, overrides, expectedCheck) => {
  // الـ trigger بيشتغل قبل الـ CHECK، فبنوقفه جوه معاملة بتتلغي عشان القيد نفسه هو اللي يرفض.
  await expect(
    owner.begin(async (tx) => {
      await tx`ALTER TABLE leave_history_reports DISABLE TRIGGER leave_history_report_guard`;
      await tx`INSERT INTO leave_history_reports ${tx({
    company_id: TENANT.A.company,
    id: randomUUID(),
    business_id: TENANT.A.business,
    created_by: USER,
    query: tx.json({}),
    fingerprint: '1'.repeat(64),
    scope: tx.json({}),
    as_of: new Date('2026-11-12T10:00:00Z'),
    deadline_at: new Date('2026-11-12T10:05:00Z'),
    status: 'pending',
    error_code: null,
    row_count: 0,
    computed_at: null,
    expires_at: new Date('2026-11-12T11:00:00Z'),
    ...overrides,
  })}`;
    }),
  ).rejects.toMatchObject({
    code: '23514',
    constraint_name: expectedCheck,
  });
});

it('CHECK constraint on rows: seq >= 1', async () => {
  const rId = await asApp((tx) => insertLeaveReport(tx));
  await expect(asApp((tx) => insertLeaveReportRow(tx, rId, 0))).rejects.toMatchObject({
    code: '23514',
    constraint_name: 'leave_history_report_rows_seq_check',
  });
});

// ننتظر حتى يتعطل المعامل على قفل غيره، بحد أقصى عشر ثوانٍ؛ وإن انتهى قبل ذلك فالاختبار فاشل.
async function waitUntilBlocked(pending: Promise<unknown>): Promise<void> {
  let settled = false;
  pending.then(
    () => (settled = true),
    () => (settled = true),
  );
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (settled) throw new Error('transaction settled before it blocked on the row insert');
    const waiting = await owner<{ waiting: boolean }[]>`
      SELECT true AS waiting FROM pg_locks WHERE NOT granted`;
    if (waiting.length > 0) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('transaction never blocked within ten seconds');
}

it('concurrent row insert vs completion: end state is never a ready report with mismatched row count', async () => {
  const rId = await asApp((tx) => insertLeaveReport(tx));
  const conn1 = postgres(testDb.appUrl, { max: 1 });
  const conn2 = postgres(testDb.appUrl, { max: 1 });
  let releaseLock: () => void = () => undefined;
  let tx1: Promise<unknown> | undefined;

  try {
    const holdTx = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    let markInserted: () => void = () => undefined;
    const inserted = new Promise<void>((resolve) => {
      markInserted = resolve;
    });
    tx1 = conn1.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${TENANT.A.company}, true), set_config('app.user_id', ${USER}, true)`;
      await insertLeaveReportRow(tx, rId, 1);
      markInserted();
      await holdTx;
    });
    await inserted;

    // conn2 attempts to complete report as ready with row_count = 0 (before row insert committed)
    const tx2 = conn2.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id', ${TENANT.A.company}, true), set_config('app.user_id', ${USER}, true)`;
      await tx`UPDATE leave_history_reports
               SET status = 'ready', row_count = 0, computed_at = now()
               WHERE id = ${rId}`;
    });

    await waitUntilBlocked(tx2);

    // Release tx1 to commit its row insert
    releaseLock();
    await tx1;

    // tx2 unblocks, rechecks row_count against rows, and must fail
    await expect(tx2).rejects.toMatchObject({
      code: '23514',
      message: expect.stringContaining('LEAVE_HISTORY_REPORT_ROW_COUNT_MISMATCH'),
    });

    // Final state is pending with 1 row, not ready with mismatched row_count
    const [finalState] = await asApp((tx) =>
      tx<{ status: string; row_count: number }[]>`SELECT status, row_count FROM leave_history_reports WHERE id = ${rId}`,
    );
    expect(finalState).toEqual({ status: 'pending', row_count: 0 });

    const [rowCount] = await asApp((tx) =>
      tx<{ count: string }[]>`SELECT count(*)::text AS count FROM leave_history_report_rows WHERE report_id = ${rId}`,
    );
    expect(rowCount?.count).toBe('1');
  } finally {
    releaseLock();
    await tx1?.catch(() => undefined);
    await conn1.end();
    await conn2.end();
  }
});
