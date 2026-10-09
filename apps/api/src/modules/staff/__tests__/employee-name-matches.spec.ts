import {
  employeeDetailRecord,
  employeeNameMatches as responseSchema,
  employeeNameMatchesInput,
} from '@pospay/contracts';
import { employeeNameMatchKey } from '@pospay/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  employeeNameMatches,
  employeeNameMatchesStatement,
} from '../queries/employee-name-matches.query.ts';
import { createEmployeeDetailAccess } from '../persistence/employee-detail-access.adapter.ts';
import {
  createForUpdate,
  employeeGrants,
  executeUpdate,
  ids,
  patchEmployee,
  updateEmployeeFixture,
  type UpdateFixture,
} from './update-employee.fixture.ts';
import { termsFor } from './employees.fixture.ts';
import { EmployeesController } from '../http/employees.controller.ts';
import type { FastifyRequest } from 'fastify';

let f: UpdateFixture;
beforeAll(async () => {
  f = await updateEmployeeFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const keys = (input: unknown) => {
  const parsed = employeeNameMatchesInput.parse(input);
  return {
    name_en_key: employeeNameMatchKey(parsed.name_en),
    name_ar_key: parsed.name_ar == null ? null : employeeNameMatchKey(parsed.name_ar),
    ...(parsed.exclude_employee_id === undefined
      ? {}
      : { exclude_employee_id: parsed.exclude_employee_id }),
  };
};
const check = (input: unknown, company = f.company, business = f.business) =>
  f.db.withTenant(company, (tx) =>
    employeeNameMatches(
      tx,
      company,
      business,
      f.userId,
      employeeNameMatchesInput.parse(input),
      createEmployeeDetailAccess(),
    ),
  );
const send = (body: object, business = f.business) =>
  f.h.send('POST', `/v1/businesses/${business}/employees/name-matches`, {
    cookie: f.cookie,
    company: f.company,
    body,
  });
const empty = { matches: [], visible_total: 0, hidden_exists: false };

it('DN-01 returns exactly the allowed projection and performs no writes', async () => {
  const record = await createForUpdate(f, { name_en: 'Sara Ahmed', name_ar: 'سارة أحمد' });
  const before = await f.h.owner`SELECT count(*) AS n FROM audit_log`;
  expect(await check({ name_en: 'Sara Ahmed', name_ar: 'سارة أحمد' })).toEqual({
    matches: [
      {
        id: record.id,
        name_en: record.name_en,
        name_ar: record.name_ar,
        primary_branch_id: f.branch,
        role_code: 'staff',
      },
    ],
    visible_total: 1,
    hidden_exists: false,
  });
  expect(await f.h.owner`SELECT count(*) AS n FROM audit_log`).toEqual(before);
});

it.each([
  ['Heba', null, '  heba ', null],
  ['Sara  AHMED', null, 'sara\tahmed', null],
  ['Ｆｕｌｌｗｉｄｔｈ', null, 'fullwidth', null],
  ['Arabic heba', 'هبة', 'Different heba', 'هبه'],
  ['Alef one', 'أميرة', 'Other one', 'اميره'],
  ['Alef two', 'إيمان', 'Other two', 'ايمان'],
  ['Alef three', 'آمال', 'Other three', 'امال'],
  ['Alef four', 'ٱبتسام', 'Other four', 'ابتسام'],
  ['Yeh', 'هدى', 'Other yeh', 'هدي'],
  ['Diacritics', 'سَارَة', 'Other diacritics', 'ساره'],
  ['Tatweel', 'ســارة', 'Other tatweel', 'ساره'],
  ['Superscript', 'هٰنا', 'Other superscript', 'هنا'],
] as const)(
  'DN-05 normalizes %s using the same key on both sides',
  async (name_en, name_ar, typedEn, typedAr) => {
    const record = await createForUpdate(f, { name_en, name_ar });
    const result = responseSchema.parse(await check({ name_en: typedEn, name_ar: typedAr }));
    expect(result.matches.map((row) => row.id)).toContain(record.id);
  },
);

it('DN-04 compares only corresponding fields, ignores absent Arabic and never matches a prefix', async () => {
  await createForUpdate(f, { name_en: 'English only', name_ar: null });
  await createForUpdate(f, { name_en: 'Different English', name_ar: 'Cross field' });
  await createForUpdate(f, { name_en: 'Long Arabic', name_ar: 'فاطمة أحمد' });
  for (const input of [
    { name_en: 'Missing English', name_ar: null },
    { name_en: 'Cross field' },
    { name_en: 'Missing English', name_ar: 'English only' },
    { name_en: 'Missing English', name_ar: 'فاطمة' },
  ])
    expect(await check(input)).toEqual(empty);
  expect(responseSchema.parse(await check({ name_en: 'English only' })).visible_total).toBe(1);
});

it('includes ended contracts but excludes soft-deleted employees', async () => {
  const ended = await createForUpdate(f, {
    name_en: 'Ended synthetic',
    contract_end: '2026-01-02',
  });
  const removed = await createForUpdate(f, { name_en: 'Removed synthetic' });
  await f.h
    .owner`UPDATE employees SET deleted_at=now() WHERE company_id=${f.company} AND id=${removed.id}`;
  expect(responseSchema.parse(await check({ name_en: ended.name_en })).matches[0]?.id).toBe(
    ended.id,
  );
  expect(await check({ name_en: removed.name_en })).toEqual(empty);
});

it('caps the stable name/id ordering at ten while counting all eleven visible matches', async () => {
  const records = [];
  for (const name_en of [
    'Cap z',
    'Cap a',
    'Cap a',
    'Cap b',
    'Cap c',
    'Cap d',
    'Cap e',
    'Cap f',
    'Cap g',
    'Cap h',
    'Cap i',
  ])
    records.push(await createForUpdate(f, { name_en, name_ar: 'تطابق متعدد' }));
  const result = responseSchema.parse(
    await check({ name_en: 'Unrelated cap', name_ar: 'تطابق متعدد' }),
  );
  expect(result.visible_total).toBe(11);
  expect(result.hidden_exists).toBe(false);
  expect(result.matches.map((row) => row.id)).toEqual(
    records
      .sort((a, b) => a.name_en.localeCompare(b.name_en) || a.id.localeCompare(b.id))
      .slice(0, 10)
      .map((row) => row.id),
  );
});

it('DN-06 excludes self, including an upper-case UUID, but retains the other identical employee', async () => {
  const first = await createForUpdate(f, { name_en: 'Excluded synthetic' });
  expect(
    await check({ name_en: first.name_en, exclude_employee_id: first.id.toUpperCase() }),
  ).toEqual(empty);
  const second = await createForUpdate(f, { name_en: first.name_en });
  const result = responseSchema.parse(
    await check({ name_en: first.name_en, exclude_employee_id: first.id.toUpperCase() }),
  );
  expect(result.matches.map((row) => row.id)).toEqual([second.id]);
});

it('DN-09 never matches employees of another business or company', async () => {
  for (const [company, branch] of [
    [f.company, f.otherBranch],
    [f.otherCompany, f.foreignBranch],
  ]) {
    await f.h
      .owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date)
      SELECT ${company as string},${ids.newId()},business_id,id,'Isolated synthetic',${employeeNameMatchKey('Isolated synthetic')},'staff','2026-01-01' FROM branches WHERE company_id=${company as string} AND id=${branch as string}`;
  }
  expect(await check({ name_en: 'Isolated synthetic' })).toEqual(empty);
  const [foreignBranch] = await f.h
    .owner`SELECT business_id FROM branches WHERE company_id=${f.otherCompany} AND id=${f.foreignBranch}`;
  const foreignBusiness = foreignBranch?.['business_id'] as string;
  const foreignStatement = employeeNameMatchesStatement(
    f.otherCompany,
    foreignBusiness,
    keys({ name_en: 'Isolated synthetic' }),
    [f.foreignBranch],
  );
  const ownRows = await f.db.withTenant(f.otherCompany, (tx) => tx.execute(foreignStatement));
  expect(responseSchema.parse(ownRows[0]).visible_total).toBe(1);
  const rows = await f.db.withTenant(f.company, (tx) => tx.execute(foreignStatement));
  expect(responseSchema.parse(rows[0])).toEqual(empty);
});

it('returns NOT_READY when the database or access provider is absent', async () => {
  for (const controller of [
    new EmployeesController(null, null, null, createEmployeeDetailAccess()),
    new EmployeesController(null, null, f.db, null),
  ])
    await expect(
      controller.nameMatches(f.business, { name_en: 'Synthetic' }, {} as FastifyRequest),
    ).rejects.toMatchObject({ code: 'NOT_READY' });
});

it('DN-10 hides a forbidden primary or open attachment, while closed attachments do not hide', async () => {
  const primary = await createForUpdate(f, {
    name_en: 'Hidden synthetic',
    primary_branch_id: f.sibling,
  });
  const secondHidden = await createForUpdate(f, {
    name_en: primary.name_en,
    primary_branch_id: f.sibling,
  });
  const attached = await createForUpdate(f, { name_en: 'Attached synthetic' });
  const expanded = await executeUpdate(f, attached, { branch_ids: [f.branch, f.sibling] });
  await employeeGrants(f, [['ALLOW', 'BRANCH', f.branch]]);
  try {
    for (const record of [primary, secondHidden, attached]) {
      const result = await check({ name_en: record.name_en });
      expect(result).toEqual({ matches: [], visible_total: 0, hidden_exists: true });
      expect(JSON.stringify(result)).not.toContain(record.id);
      expect(JSON.stringify(result)).not.toContain(record.name_en);
    }
    const response = await send({ name_en: primary.name_en });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ matches: [], visible_total: 0, hidden_exists: true });
    expect(JSON.stringify(response.body)).not.toContain(primary.id);
    expect(JSON.stringify(response.body)).not.toContain(secondHidden.id);
    expect(JSON.stringify(response.body)).not.toContain(primary.name_en);
  } finally {
    await employeeGrants(f, [['ALLOW', 'BUSINESS', f.business]]);
  }
  await executeUpdate(f, expanded, { branch_ids: [f.branch], branch_effective_date: '2026-10-04' });
  await employeeGrants(f, [['ALLOW', 'BRANCH', f.branch]]);
  try {
    expect(responseSchema.parse(await check({ name_en: attached.name_en })).visible_total).toBe(1);
  } finally {
    await employeeGrants(f, [['ALLOW', 'BUSINESS', f.business]]);
  }
});

it('uses employees_company_business_name_en_key_idx for the scoped scan', async () => {
  const rows = Array.from({ length: 2000 }, (_, i) => {
    const name = `Plan filler ${i}`;
    return { id: ids.newId(), name_en: name, name_en_key: employeeNameMatchKey(name) };
  });
  await f.h
    .owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date)
    SELECT ${f.company},id,${f.business},${f.branch},name_en,name_en_key,'staff','2026-01-01'
    FROM jsonb_to_recordset(${f.h.owner.json(rows)}) AS r(id uuid,name_en text,name_en_key text)`;
  await f.h.owner`ANALYZE employees`;
  const plan = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${employeeNameMatchesStatement(f.company, f.business, keys({ name_en: 'Heba', name_ar: 'هبة' }), [f.branch, f.sibling])}`,
    );
  });
  expect(JSON.stringify(plan)).toContain('employees_company_business_name_en_key_idx');
});

it('DN-11 authenticates, rejects no grant, accepts branch-only ALLOW and hides branch DENY', async () => {
  const url = `/v1/businesses/${f.business}/employees/name-matches`;
  expect(
    (await f.h.app.inject({ method: 'POST', url, payload: { name_en: 'Heba' } })).statusCode,
  ).toBe(401);
  await employeeGrants(f, []);
  expect(await send({ name_en: 'Heba' })).toMatchObject({
    status: 403,
    body: { code: 'FORBIDDEN' },
  });
  await employeeGrants(f, [['ALLOW', 'BRANCH', f.branch]]);
  expect(await send({ name_en: 'Heba' })).toMatchObject({
    status: 200,
    body: { visible_total: 1, hidden_exists: false },
  });
  await employeeGrants(f, [
    ['ALLOW', 'BUSINESS', f.business],
    ['DENY', 'BRANCH', f.sibling],
  ]);
  expect(await send({ name_en: 'Hidden synthetic' })).toMatchObject({
    status: 200,
    body: { matches: [], visible_total: 0, hidden_exists: true },
  });
  await employeeGrants(f, [['ALLOW', 'BUSINESS', f.business]]);
});

it('DN-11 refuses feature-off and invalid input; static POST and parameterized GET coexist', async () => {
  for (const body of [{}, { name_en: ' ' }, { name_en: 'Heba', company_id: f.company }])
    expect(await send(body)).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } });
  expect(await send({ name_en: 'Heba' }, 'invalid')).toMatchObject({
    status: 400,
    body: { code: 'VALIDATION_FAILED' },
  });
  const result = await send({ name_en: 'Heba' });
  expect(result.status).toBe(200);
  const record = responseSchema.parse(result.body).matches[0];
  expect(
    (
      await f.h.send('GET', `/v1/businesses/${f.business}/employees/${record?.id}`, {
        cookie: f.cookie,
        company: f.company,
      })
    ).status,
  ).toBe(200);
  await f.h
    .owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by) VALUES (${f.company},'staff',false,'Synthetic disabled',${f.userId})`;
  try {
    expect((await send({ name_en: 'Heba' })).body['code']).toBe('FEATURE_DISABLED');
  } finally {
    await f.h
      .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='staff'`;
  }
});

it('DN-13 duplicate create and update remain successful with ordinary audit and attachments', async () => {
  const first = await createForUpdate(f, { name_en: 'Duplicate write' });
  const created = await f.h.send('POST', `/v1/businesses/${f.business}/employees`, {
    cookie: f.cookie,
    company: f.company,
    body: termsFor(f, first.name_en),
  });
  expect(created.status).toBe(201);
  const second = await createForUpdate(f, { name_en: 'Before rename' });
  const updated = await patchEmployee(f, second, { name_en: first.name_en });
  expect(updated.status).toBe(200);
  expect(employeeDetailRecord.parse(updated.body).revision).toBe(second.revision + 1);
  expect(
    await f.h
      .owner`SELECT action FROM audit_log WHERE company_id=${f.company} AND entity_id=${created.body['id'] as string}`,
  ).toEqual([{ action: 'created' }]);
  expect(
    await f.h
      .owner`SELECT id FROM employee_branches WHERE company_id=${f.company} AND employee_id=${created.body['id'] as string}`,
  ).toHaveLength(1);
});
