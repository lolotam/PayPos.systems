import { afterAll, beforeAll, expect, it } from 'vitest';
import type { StaffColumnCode } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import { ownWorkReads, ordersLinePerformers } from '../orders.module.ts';
import { ChangeLinePerformersUseCase } from '../use-cases/change-line-performers/change-line-performers.usecase.ts';
import { readOwnServiceLines } from '../queries/own-service-lines.query.ts';
import {
  AT,
  cancelLine,
  ids,
  interceptDatabase,
  must,
  pairLine,
  recordVisit,
  recordVisitAt,
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
const only = (...codes: StaffColumnCode[]) => ({
  ...ownWorkReads,
  allowed: async () => new Set<StaffColumnCode>(codes),
});
const read = (query: unknown = {}, reads = ownWorkReads, db: TenantWrappers = f.db) =>
  db.withTenant(f.company, (tx) => readOwnServiceLines(tx, context(), query, now, reads), {
    userId: f.ownerId,
    readOnly: true,
  });
const colleagueLine = () => ({ ...f.line(), performers: [{ employee_id: must(f.employees[1]) }] });

it('MY01 returns exactly her current lines with her own share and never a colleague line', async () => {
  const own = await recordVisit(f, [pairLine(f)]);
  const colleague = await recordVisit(f, [colleagueLine()]);
  const response = await read();
  const returned = response.items.map((line) => line.line_id);
  expect(returned).toContain(must(own.lineIds[0]));
  expect(returned).not.toContain(must(colleague.lineIds[0]));
  expect(response.items.find((line) => line.line_id === own.lineIds[0])).toMatchObject({
    customer_name: 'Synthetic customer',
    share_bps: 5000,
  });
  expect(JSON.stringify(response)).not.toMatch(
    /phone|employee_id|customer_id|recorded_by|rating|comment/,
  );
});

it('D-A9 carries the business IANA time zone at the top level of a page with lines', async () => {
  await recordVisit(f);
  const response = await read();
  expect(response.items.length).toBeGreaterThan(0);
  expect(response.time_zone).toBe('Asia/Kuwait');
});

it('MY02 projects each toggled column alone; a hidden column is absent and never selected', async () => {
  const visit = await recordVisit(f);
  const fields: [StaffColumnCode, string[], RegExp][] = [
    ['date', ['date', 'late'], /\blate\b/],
    ['time', ['time'], /occurred_at/],
    ['service', ['service_name_ar', 'service_name_en'], /name_en/],
    ['customer_name', ['customer_name'], /customer_name/],
    ['list_price', ['list_price'], /list_price/],
    ['discount', ['discount'], /\bdiscount\b/],
    ['net', ['net'], /\bnet\b/],
    ['share', ['share_bps'], /share_bps/],
  ];
  for (const [code, keys] of fields) {
    const statements: string[] = [];
    const db = interceptDatabase(f.db, async (statement) => void statements.push(statement));
    const line = (await read({}, only(code), db)).items.find(
      (row) => row.line_id === visit.lineIds[0],
    );
    expect(Object.keys(line ?? {}).sort()).toEqual(
      ['line_id', 'branch_name_ar', 'branch_name_en', 'cancelled', ...keys].sort(),
    );
    const selected = statements
      .filter((text) => /FROM\s+(service_|line_performers)/.test(text))
      .map((text) => /SELECT([\s\S]*?)\sFROM/.exec(text)?.[1] ?? '');
    for (const [other, , token] of fields)
      if (other !== code && other !== 'time')
        expect(selected.filter((list) => token.test(list))).toEqual([]);
    for (const list of selected)
      expect(list).not.toMatch(/phone|rating|comment|linked_user|customer_id|recorded_by/);
  }
});

it('selects nothing but ids from line_performers: no colleague id, name or share when share is hidden', async () => {
  const statements: string[] = [];
  const db = interceptDatabase(f.db, async (statement) => void statements.push(statement));
  await read({}, only(), db);
  const performers = statements.filter((text) => /FROM\s+line_performers/.test(text));
  expect(performers.length).toBeGreaterThan(0);
  for (const text of performers)
    expect(/SELECT([\s\S]*?)\sFROM/.exec(text)?.[1]?.trim()).toBe('line_id');
  expect(statements.join('\n')).not.toMatch(/customer_phone|rating|comment/);
});

it('puts a late line under its own business date, with late only beside date', async () => {
  const september = await recordVisitAt(f, '2026-09-20T08:00:00.000Z');
  f.setAt(new Date('2026-10-14T08:05:00.000Z'));
  const onTime = await recordVisit(f);
  f.setAt(AT);
  const late = await read({ month: '2026-09' }, only('date'));
  expect(late.items.find((l) => l.line_id === september.lineIds[0])).toMatchObject({
    date: '2026-09-20',
    late: true,
  });
  const october = await read({}, only('date'));
  expect(october.items.map((l) => l.line_id)).not.toContain(must(september.lineIds[0]));
  expect(october.items.find((l) => l.line_id === onTime.lineIds[0])).toMatchObject({
    date: '2026-10-14',
    late: false,
  });
  const dateless = (await read({}, only('time'))).items[0];
  expect(dateless).not.toHaveProperty('late');
  expect(dateless).not.toHaveProperty('date');
});

it('walks lines with tied sort keys without a gap or a duplicate, and a cancelled anchor stays valid', async () => {
  const visit = await recordVisit(f, [f.line(), f.line(), f.line()]);
  const hidden = only();
  const first = await read({ limit: 1 }, hidden);
  expect(first.next_cursor).toBe(first.items[0]?.line_id);
  await cancelLine(f, must(first.next_cursor));
  const second = await read({ limit: 1, cursor: first.next_cursor }, hidden);
  expect(second.items[0]?.line_id).not.toBe(first.next_cursor);
  const walked: string[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  do {
    // مؤشر اتشاف قبل كده معناه إن الصفحات بتلف في مكانها: الاختبار بيفشل فوراً بدل ما يكمل قراءات لحد المهلة.
    if (cursor !== undefined) {
      expect(seenCursors.has(cursor), `cursor ${cursor} repeated`).toBe(false);
      seenCursors.add(cursor);
    }
    const page = await read({ limit: 1, ...(cursor ? { cursor } : {}) }, hidden);
    walked.push(...page.items.map((line) => line.line_id));
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  const everything = (await read({ limit: 100 }, hidden)).items.map((line) => line.line_id);
  expect(walked).toEqual(everything);
  expect(new Set(walked).size).toBe(walked.length);
  for (const lineId of visit.lineIds) expect(walked).toContain(lineId);
  const anchor = (await read({ limit: 100 }, hidden)).items.find(
    (line) => line.line_id === first.next_cursor,
  );
  expect(anchor).toMatchObject({ cancelled: true, cancelled_at: expect.any(String) });
});

it('returns one uniform 400 for unknown, removed, colleague and other-month anchors', async () => {
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
  const september = await recordVisitAt(f, '2026-09-20T08:00:00.000Z');
  const colleague = await recordVisit(f, [colleagueLine()]);
  expect((await read({ month: '2026-09', limit: 100 })).items.length).toBeGreaterThan(0);
  const errors: unknown[] = [];
  for (const query of [
    { cursor: ids.newId() },
    { cursor: must(visit.lineIds[0]) },
    { cursor: must(colleague.lineIds[0]) },
    { month: '2026-10', cursor: must(september.lineIds[0]) },
    { month: '2026-09', cursor: must(colleague.lineIds[0]) },
  ])
    errors.push(await read(query).catch((error: unknown) => error));
  for (const error of errors) expect(error).toMatchObject({ code: 'VALIDATION_FAILED' });
  expect(new Set(errors.map((error) => JSON.stringify(error))).size).toBe(1);
});

it('keeps old inactive-branch history after a transfer while the device branch proves current authority', async () => {
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
  const current = await f.create.execute({
    ...f.context(),
    branchId: newBranch,
    input: { ...f.body(), occurred_at: '2026-10-15T07:00:00.000Z' },
  });
  try {
    const onDevice = (branchId: string) =>
      f.db.withTenant(
        f.company,
        (tx) => readOwnServiceLines(tx, { ...context(), branchId }, {}, now, ownWorkReads),
        { userId: f.ownerId, readOnly: true },
      );
    const response = await onDevice(newBranch);
    const returned = response.items.map((line) => line.line_id);
    expect(returned).toContain(must(visit.lineIds[0]));
    expect(returned).toContain(must(current.session.lines[0]).id);
    expect(response.items.find((l) => l.line_id === visit.lineIds[0])?.branch_name_en).toBe(
      'Synthetic branch',
    );
    expect(
      response.items.find((l) => l.line_id === current.session.lines[0]?.id)?.branch_name_en,
    ).toBe('New current branch');
    await expect(onDevice(f.branch)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  } finally {
    await f.h
      .owner`UPDATE branches SET is_active=true WHERE company_id=${f.company} AND id=${f.branch}`;
  }
});

it('MY13 applies default, configured and legacy-clamped month windows through the real settings reader', async () => {
  for (const [stored, accepted, refused] of [
    [null, '2026-09', '2026-08'],
    [3, '2026-08', '2026-07'],
    [12, '2025-11', '2025-10'],
  ] as const) {
    await f.h.owner`INSERT INTO business_settings(company_id,business_id,staff_months_back)
      VALUES(${f.company},${f.business},${stored})
      ON CONFLICT(company_id,business_id) DO UPDATE SET staff_months_back=EXCLUDED.staff_months_back`;
    expect((await read({ month: accepted })).month).toBe(accepted);
    await expect(read({ month: refused })).rejects.toMatchObject({
      code: 'MY_PERIOD_OUT_OF_RANGE',
    });
  }
  // القيمة 24 اتحفظت تحت المدى القديم: القيد المضيّق (issue #519) بيمنعها، فنبدّله مؤقتاً ونحاكي
  // بيانات قبل التضييق، والقراية بتقصّرها على 12 في الدومين، وبعدين القيد بيرجع متحقَّق.
  await f.h.owner`ALTER TABLE business_settings
    DROP CONSTRAINT IF EXISTS business_settings_staff_months_back`;
  try {
    await f.h.owner`INSERT INTO business_settings(company_id,business_id,staff_months_back)
      VALUES(${f.company},${f.business},24)
      ON CONFLICT(company_id,business_id) DO UPDATE SET staff_months_back=EXCLUDED.staff_months_back`;
    expect((await read({ month: '2025-11' })).month).toBe('2025-11');
    await expect(read({ month: '2025-10' })).rejects.toMatchObject({
      code: 'MY_PERIOD_OUT_OF_RANGE',
    });
  } finally {
    await f.h.owner`UPDATE business_settings SET staff_months_back=12
      WHERE company_id=${f.company} AND business_id=${f.business} AND staff_months_back>12`;
    await f.h.owner`ALTER TABLE business_settings
      ADD CONSTRAINT business_settings_staff_months_back
      CHECK (staff_months_back IS NULL OR staff_months_back BETWEEN 1 AND 12) NOT VALID`;
    await f.h.owner`ALTER TABLE business_settings
      VALIDATE CONSTRAINT business_settings_staff_months_back`;
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
