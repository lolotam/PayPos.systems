import { afterAll, beforeAll, expect, it } from 'vitest';
import { employeeNameMatchKey } from '@pospay/domain';
import {
  createForUpdate,
  executeUpdate,
  patchEmployee,
  updateEmployeeFixture,
  updateTerms,
  type UpdateFixture,
} from './update-employee.fixture.ts';
import { UpdateEmployeeUseCase } from '../use-cases/update-employee/update-employee.usecase.ts';
import { ids } from './update-employee.fixture.ts';
let f: UpdateFixture;
beforeAll(async () => {
  f = await updateEmployeeFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it.each([
  { name_en: 'Changed synthetic name' },
  { name_ar: 'اسم تجريبي' },
  { role_code: 'cashier' },
  { hire_date: '2999-01-01' },
  { contract_end: '2027-01-01' },
] as const)(
  'UE-01 changes each editable field %j with before/after audit and no access effects',
  async (change) => {
    const record = await createForUpdate(f);
    const beforeMemberships = await f.h.owner`SELECT * FROM memberships ORDER BY company_id,id`;
    const beforeGrants = await f.h.owner`SELECT * FROM permission_overrides ORDER BY company_id,id`;
    const response = await patchEmployee(f, record, change);
    expect(response.status).toBe(200);
    expect(response.body).not.toHaveProperty('name_en_key');
    expect(response.body).not.toHaveProperty('name_ar_key');
    const names = { ...record, ...change };
    expect(
      await f.h.owner`SELECT name_en_key,name_ar_key FROM employees WHERE id=${record.id}`,
    ).toEqual([
      {
        name_en_key: employeeNameMatchKey(names.name_en),
        name_ar_key: names.name_ar === null ? null : employeeNameMatchKey(names.name_ar),
      },
    ]);
    expect(response.body).toMatchObject({
      ...change,
      revision: 2,
      id: record.id,
      created_at: record.created_at,
      branch_ids: [f.branch],
    });
    expect(
      await f.h.owner`SELECT "from"::text FROM employee_branches WHERE employee_id=${record.id}`,
    ).toEqual([{ from: record.hire_date }]);
    expect(
      await f.h
        .owner`SELECT actor_user_id,action,before,after FROM audit_log WHERE entity_id=${record.id} AND action='updated'`,
    ).toEqual([
      { actor_user_id: f.userId, action: 'updated', before: record, after: response.body },
    ]);
    expect(await f.h.owner`SELECT * FROM memberships ORDER BY company_id,id`).toEqual(
      beforeMemberships,
    );
    expect(await f.h.owner`SELECT * FROM permission_overrides ORDER BY company_id,id`).toEqual(
      beforeGrants,
    );
    expect(await f.h.owner`SELECT id FROM outbox WHERE aggregate_id=${record.id}`).toHaveLength(0);
  },
);
it('UE-03 rejects contract end before hire and permits duplicate names and future hire dates', async () => {
  const a = await createForUpdate(f),
    b = await createForUpdate(f);
  expect(await patchEmployee(f, a, { contract_end: '2025-12-31' })).toMatchObject({
    status: 400,
    body: { code: 'EMPLOYEE_CONTRACT_END_BEFORE_HIRE' },
  });
  expect(
    await executeUpdate(f, a, {
      name_en: b.name_en,
      hire_date: '2999-01-01',
      contract_end: '2999-01-01',
    }),
  ).toMatchObject({ revision: 2, name_en: b.name_en, hire_date: '2999-01-01' });
});
it('replaces both name keys on rename, keeps them on non-name edits and clears absent Arabic', async () => {
  const original = await createForUpdate(f, { name_en: 'ＳＡＲＡ', name_ar: 'سَـارة' });
  const renamed = await executeUpdate(f, original, {
    name_en: 'HEBA  Ahmed',
    name_ar: 'هِبَة أحمد',
  });
  const expected = { name_en_key: 'heba ahmed', name_ar_key: 'هبه احمد' };
  expect(
    await f.h.owner`SELECT name_en_key,name_ar_key FROM employees WHERE id=${original.id}`,
  ).toEqual([expected]);
  const changed = await executeUpdate(f, renamed, { role_code: 'cashier' });
  expect(
    await f.h.owner`SELECT name_en_key,name_ar_key FROM employees WHERE id=${original.id}`,
  ).toEqual([expected]);
  await executeUpdate(f, changed, { name_ar: null });
  expect(
    await f.h.owner`SELECT name_en_key,name_ar_key FROM employees WHERE id=${original.id}`,
  ).toEqual([{ ...expected, name_ar_key: null }]);
});
it('UE-04 attaches, detaches, changes primary and reattaches without deleting history', async () => {
  const original = await createForUpdate(f);
  const attached = await executeUpdate(f, original, { branch_ids: [f.branch, f.sibling] });
  const moved = await executeUpdate(f, attached, {
    primary_branch_id: f.sibling,
    branch_ids: [f.sibling],
    branch_effective_date: '2026-10-04',
  });
  const restored = await executeUpdate(f, moved, {
    branch_ids: [f.branch, f.sibling],
    branch_effective_date: '2026-10-05',
  });
  expect(restored).toMatchObject({
    primary_branch_id: f.sibling,
    revision: 4,
    branch_ids: [f.branch, f.sibling].sort(),
  });
  const history = await f.h
    .owner`SELECT branch_id,"from"::text,"to"::text FROM employee_branches WHERE employee_id=${original.id} ORDER BY "from",branch_id`;
  expect(history).toEqual([
    { branch_id: f.branch, from: '2026-01-01', to: '2026-10-04' },
    { branch_id: f.sibling, from: '2026-10-03', to: null },
    { branch_id: f.branch, from: '2026-10-05', to: null },
  ]);
  expect(
    await f.h.owner`SELECT id FROM audit_log WHERE entity_id=${original.id} AND action='updated'`,
  ).toHaveLength(3);
  const audit = await f.h
    .owner`SELECT after FROM audit_log WHERE entity_id=${original.id} AND action='updated' ORDER BY id`;
  expect(audit.map((row) => row['after'].branch_change.effective_date)).toEqual([
    '2026-10-03',
    '2026-10-04',
    '2026-10-05',
  ]);
  expect(audit[1]?.['after'].branch_change.closed_attachment_ids).toHaveLength(1);
  expect(audit[0]?.['after'].branch_change.attached).toEqual([
    { id: expect.any(String), branchId: f.sibling },
  ]);
});
it('primary-only change on an already attached branch keeps both history rows', async () => {
  const original = await createForUpdate(f);
  const attached = await executeUpdate(f, original, { branch_ids: [f.branch, f.sibling] });
  const history = await f.h
    .owner`SELECT * FROM employee_branches WHERE employee_id=${original.id} ORDER BY id`;
  expect(await executeUpdate(f, attached, { primary_branch_id: f.sibling })).toMatchObject({
    revision: 3,
    primary_branch_id: f.sibling,
  });
  expect(
    await f.h.owner`SELECT * FROM employee_branches WHERE employee_id=${original.id} ORDER BY id`,
  ).toEqual(history);
});
it('refuses primary removal, empty sets and reversed history dates without partial changes', async () => {
  const original = await createForUpdate(f);
  const audits = await f.h.owner`SELECT id FROM audit_log WHERE entity_id=${original.id}`;
  expect(await patchEmployee(f, original, { branch_ids: [f.sibling] })).toMatchObject({
    status: 400,
    body: { code: 'EMPLOYEE_PRIMARY_BRANCH_REQUIRED' },
  });
  expect(await patchEmployee(f, original, { branch_ids: [] })).toMatchObject({
    status: 400,
    body: { code: 'VALIDATION_FAILED' },
  });
  expect(
    await patchEmployee(f, original, {
      primary_branch_id: f.sibling,
      branch_ids: [f.sibling],
      branch_effective_date: '2025-12-31',
    }),
  ).toMatchObject({ status: 400, body: { code: 'EMPLOYEE_BRANCH_DATE_BEFORE_START' } });
  expect(await f.h.owner`SELECT revision FROM employees WHERE id=${original.id}`).toEqual([
    { revision: 1 },
  ]);
  expect(await f.h.owner`SELECT id FROM audit_log WHERE entity_id=${original.id}`).toEqual(audits);
});
it('UE-05 concurrent HTTP updates return one success and one named 409 with one audit', async () => {
  const record = await createForUpdate(f);
  const results = await Promise.all([
    patchEmployee(f, record, { name_en: 'Manager A' }),
    patchEmployee(f, record, { name_en: 'Manager B' }),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(results.find((r) => r.status === 409)?.body).toMatchObject({
    code: 'EMPLOYEE_REVISION_CONFLICT',
    message_ar: expect.any(String),
    message_en: expect.any(String),
  });
  expect(
    await f.h.owner`SELECT action FROM audit_log WHERE entity_id=${record.id} AND action='updated'`,
  ).toHaveLength(1);
});
it('unchanged and reordered branch sets are a no-op but still require the current revision', async () => {
  const record = await createForUpdate(f);
  expect(await executeUpdate(f, record)).toEqual(record);
  expect(
    await f.h.owner`SELECT name_en_key,name_ar_key FROM employees WHERE id=${record.id}`,
  ).toEqual([
    {
      name_en_key: employeeNameMatchKey(record.name_en),
      name_ar_key: record.name_ar === null ? null : employeeNameMatchKey(record.name_ar),
    },
  ]);
  expect(
    await f.h.owner`SELECT id FROM audit_log WHERE entity_id=${record.id} AND action='updated'`,
  ).toHaveLength(0);
  expect(await patchEmployee(f, record, { expected_revision: 99 })).toMatchObject({
    status: 409,
    body: { code: 'EMPLOYEE_REVISION_CONFLICT' },
  });
});
it('UE-07 failed audit insert rolls back changed data, revision and history', async () => {
  const record = await createForUpdate(f);
  const idsThatFailAudit = { newId: () => record.id };
  const transactions = (
    await import('../persistence/drizzle-employee-update.ts')
  ).createEmployeeUpdateTransactions(f.db, idsThatFailAudit);
  await f.h
    .owner`INSERT INTO audit_log(company_id,id,entity,entity_id,action) VALUES (${f.company},${record.id},'synthetic',${record.id},'created')`;
  const failing = new UpdateEmployeeUseCase(transactions, ids);
  const history = await f.h.owner`SELECT * FROM employee_branches WHERE employee_id=${record.id}`;
  await expect(
    failing.execute({
      companyId: f.company,
      userId: f.userId,
      businessId: f.business,
      employeeId: record.id,
      input: updateTerms(record, {
        name_en: 'Must roll back',
        primary_branch_id: f.sibling,
        branch_ids: [f.sibling],
      }),
    }),
  ).rejects.toThrow('EMPLOYEE_PERSISTENCE_FAILED');
  expect(
    await f.h.owner`SELECT name_en,revision,primary_branch_id FROM employees WHERE id=${record.id}`,
  ).toEqual([{ name_en: record.name_en, revision: 1, primary_branch_id: f.branch }]);
  expect(await f.h.owner`SELECT * FROM employee_branches WHERE employee_id=${record.id}`).toEqual(
    history,
  );
});
it.each([{ business: 'foreign' }, { branch: 'foreign' }, { branch: 'other' }])(
  'rejects target boundaries %j',
  async (change) => {
    const record = await createForUpdate(f);
    const response = await patchEmployee(
      f,
      record,
      change.branch
        ? {
            primary_branch_id: change.branch === 'foreign' ? f.foreignBranch : f.otherBranch,
            branch_ids: [change.branch === 'foreign' ? f.foreignBranch : f.otherBranch],
          }
        : {},
      change.business ? f.secondBusiness : f.business,
    );
    expect(response.status).toBe(404);
  },
);
