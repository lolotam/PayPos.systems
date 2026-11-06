import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { ownWorkReads, ordersLinePerformers } from '../orders.module.ts';
import { ChangeLinePerformersUseCase } from '../use-cases/change-line-performers/change-line-performers.usecase.ts';
import {
  readOwnServiceLines,
  ownServiceLinesStatement,
} from '../queries/own-service-lines.query.ts';
import {
  cancelLine,
  ids,
  must,
  pairLine,
  recordVisit,
  tipFixture,
  type TipFixture,
} from '../../../../test/session-tips.fixture.ts';

let f: TipFixture;
const now = new Date('2026-10-15T08:00:00Z');
beforeAll(async () => {
  f = await tipFixture();
  await f.linkEmployee(must(f.employees[0]), f.ownerId);
});
afterAll(async () => {
  await f?.close();
});
const context = () => ({ companyId: f.company, businessId: f.business, userId: f.ownerId });
const read = (query: unknown = {}) =>
  f.db.withTenant(f.company, (tx) => readOwnServiceLines(tx, context(), query, now, ownWorkReads), {
    userId: f.ownerId,
  });

it('MY01/03/04 returns only current own lines, snapshot names and own share', async () => {
  const own = await recordVisit(f, [pairLine(f)]);
  await recordVisit(f, [{ ...f.line(), performers: [{ employee_id: must(f.employees[1]) }] }]);
  const response = await read();
  expect(response.items.map((line) => line.line_id)).toEqual(own.lineIds);
  expect(response.items[0]).toMatchObject({ customer_name: 'Synthetic customer', share_bps: 5000 });
  expect(JSON.stringify(response)).not.toMatch(
    /phone|employee_id|customer_id|recorded_by|rating|comment/,
  );
});

it('MY02 projects every toggled field on the server and late follows date', async () => {
  const visit = await recordVisit(f);
  const codes = [
    'date',
    'time',
    'service',
    'customer_name',
    'list_price',
    'discount',
    'net',
    'share',
  ] as const;
  const fields = [
    ['date', 'late'],
    ['time'],
    ['service_name_ar', 'service_name_en'],
    ['customer_name'],
    ['list_price'],
    ['discount'],
    ['net'],
    ['share_bps'],
  ];
  for (const [index, code] of codes.entries()) {
    const visible = await f.db.withTenant(f.company, (tx) =>
      readOwnServiceLines(tx, context(), {}, now, {
        ...ownWorkReads,
        allowed: async () => new Set([code]),
      }),
    );
    const line = visible.items.find((row) => row.line_id === visit.lineIds[0]);
    expect(Object.keys(line ?? {}).sort()).toEqual(
      ['line_id', 'branch_name_ar', 'branch_name_en', 'cancelled', ...must(fields[index])].sort(),
    );
  }
});

it('walks tied dates with date/time hidden and keeps a cancelled anchor valid', async () => {
  const visit = await recordVisit(f, [f.line(), f.line(), f.line()]);
  const readHidden = (query: unknown) =>
    f.db.withTenant(f.company, (tx) =>
      readOwnServiceLines(tx, context(), query, now, {
        ...ownWorkReads,
        allowed: async () => new Set(),
      }),
    );
  const first = await readHidden({ limit: 1 });
  expect(first.next_cursor).toBe(first.items[0]?.line_id);
  await cancelLine(f, must(first.next_cursor));
  const second = await readHidden({ limit: 1, cursor: first.next_cursor });
  expect(second.items[0]?.line_id).not.toBe(first.next_cursor);
  const walked: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await readHidden({ limit: 1, ...(cursor ? { cursor } : {}) });
    walked.push(...page.items.map((line) => line.line_id));
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  expect(new Set(walked).size).toBe(walked.length);
  for (const lineId of visit.lineIds) expect(walked).toContain(lineId);
  expect(walked).toEqual([...walked].sort().reverse());
  const cancelled = await readHidden({});
  expect(cancelled.items.find((line) => line.line_id === first.next_cursor)).toMatchObject({
    cancelled: true,
    cancelled_at: expect.any(String),
  });
});

it('returns uniform 400 for unknown, removed, colleague and other-month anchors', async () => {
  const visit = await recordVisit(f);
  await f.h
    .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${ids.newId()},${f.membership},'change:service-line-performers:branch','ALLOW','BRANCH',${f.branch},'Synthetic removal authority',${f.ownerId})`;
  await new ChangeLinePerformersUseCase(ordersLinePerformers(f.db), ids, f.clock).execute({
    ...f.context(),
    sessionId: visit.sessionId,
    lineId: must(visit.lineIds[0]),
    input: {
      expected_revision: 1,
      reason: 'Synthetic performer removal',
      performers: [{ employee_id: must(f.employees[1]), share_bps: 10000 }],
    },
  });
  const otherMonth = await recordVisit(f);
  const colleague = await recordVisit(f, [
    { ...f.line(), performers: [{ employee_id: must(f.employees[1]) }] },
  ]);
  for (const cursor of [ids.newId(), must(visit.lineIds[0]), must(colleague.lineIds[0])])
    await expect(read({ cursor })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  await expect(
    read({ month: '2026-09', cursor: must(otherMonth.lineIds[0]) }),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
});

it('retains old inactive branch history after transfer while device branch proves current authority', async () => {
  const visit = await recordVisit(f);
  const newBranch = ids.newId();
  await f.h
    .owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES(${f.company},${newBranch},${f.business},'New current branch')`;
  await f.h
    .owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES(${f.company},${ids.newId()},${f.business},${must(f.employees[0])},${newBranch},'2026-10-15')`;
  await f.h
    .owner`UPDATE employee_branches SET "to"='2026-10-15' WHERE company_id=${f.company} AND employee_id=${must(f.employees[0])} AND branch_id=${f.branch}`;
  await f.h
    .owner`UPDATE branches SET is_active=false WHERE company_id=${f.company} AND id=${f.branch}`;
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at,limit_bps)
    SELECT company_id,${ids.newId()},user_id,role_id,role_owner_key,'BRANCH',${newBranch},'2026-01-01',limit_bps
    FROM memberships WHERE company_id=${f.company} AND id=${f.membership}`;
  const currentVisit = await f.create.execute({
    ...f.context(),
    branchId: newBranch,
    input: { ...f.body(), occurred_at: '2026-10-15T07:00:00.000Z' },
  });
  try {
    const response = await f.db.withTenant(f.company, (tx) =>
      readOwnServiceLines(tx, { ...context(), branchId: newBranch }, {}, now, ownWorkReads),
    );
    expect(response.items.map((line) => line.line_id)).toContain(visit.lineIds[0]);
    expect(response.items.map((line) => line.line_id)).toContain(currentVisit.session.lines[0]?.id);
    expect(response.items.find((line) => line.line_id === visit.lineIds[0])?.branch_name_en).toBe(
      'Synthetic branch',
    );
    await expect(
      f.db.withTenant(f.company, (tx) =>
        readOwnServiceLines(tx, { ...context(), branchId: f.branch }, {}, now, ownWorkReads),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  } finally {
    await f.h
      .owner`UPDATE branches SET is_active=true WHERE company_id=${f.company} AND id=${f.branch}`;
  }
});

it('has a result shape and an analysed plan using existing tenant/performer indexes', async () => {
  const plan = await f.db.withTenant(f.company, (tx) =>
    tx.execute(sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    ${ownServiceLinesStatement(
      context(),
      must(f.employees[0]),
      '2026-10',
      [{ id: f.branch, name_ar: null, name_en: 'Synthetic branch' }],
      new Set(),
      20,
    )}`),
  );
  expect(JSON.stringify(plan)).toMatch(/line_performers|service_lines/);
  expect((await read()).items.length).toBeGreaterThan(0);
});

it('MY13 applies default, configured and legacy-clamped month windows through the real settings reader', async () => {
  for (const [stored, accepted, refused] of [
    [null, '2026-09', '2026-08'],
    [3, '2026-08', '2026-07'],
    [12, '2025-11', '2025-10'],
    [24, '2025-11', '2025-10'],
  ] as const) {
    await f.h.owner`INSERT INTO business_settings(company_id,business_id,staff_months_back)
      VALUES(${f.company},${f.business},${stored})
      ON CONFLICT(company_id,business_id) DO UPDATE SET staff_months_back=EXCLUDED.staff_months_back`;
    expect((await read({ month: accepted })).month).toBe(accepted);
    await expect(read({ month: refused })).rejects.toMatchObject({
      code: 'MY_PERIOD_OUT_OF_RANGE',
    });
  }
  await f.h
    .owner`UPDATE business_settings SET staff_months_back=NULL WHERE company_id=${f.company} AND business_id=${f.business}`;
  await expect(read({ month: 'bad' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
});

it('rechecks the orders feature before diagnosing even a malformed month', async () => {
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES(${f.company},'orders',false,'Synthetic feature refusal',${f.ownerId})`;
  try {
    await expect(read({ month: 'bad' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  } finally {
    await f.h
      .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='orders'`;
  }
});
