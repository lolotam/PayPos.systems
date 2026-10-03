import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { lockedEmployee } from '../persistence/employee-update-record.ts';
import {
  createForUpdate,
  executeUpdate,
  patchEmployee,
  ids,
  updateEmployeeFixture,
  type UpdateFixture,
} from './update-employee.fixture.ts';
let f: UpdateFixture;
beforeAll(async () => {
  f = await updateEmployeeFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
async function movedEmployee() {
  const original = await createForUpdate(f);
  return executeUpdate(f, original, {
    primary_branch_id: f.sibling,
    branch_ids: [f.sibling],
    branch_effective_date: '2026-10-15',
  });
}
it('A→B on Oct 15 then A on Oct 10 is a named 409 with no revision, audit or history changes', async () => {
  const moved = await movedEmployee();
  const before = await f.h
    .owner`SELECT * FROM employee_branches WHERE employee_id=${moved.id} ORDER BY id`;
  const refused = await patchEmployee(f, moved, {
    branch_ids: [f.branch, f.sibling],
    branch_effective_date: '2026-10-10',
  });
  expect(refused).toMatchObject({
    status: 409,
    body: {
      code: 'EMPLOYEE_BRANCH_HISTORY_OVERLAP',
      message_ar: expect.any(String),
      message_en: expect.any(String),
    },
  });
  expect(
    await f.h.owner`SELECT * FROM employee_branches WHERE employee_id=${moved.id} ORDER BY id`,
  ).toEqual(before);
  expect(await f.h.owner`SELECT revision FROM employees WHERE id=${moved.id}`).toEqual([
    { revision: 2 },
  ]);
  expect(
    await f.h.owner`SELECT id FROM audit_log WHERE entity_id=${moved.id} AND action='updated'`,
  ).toHaveLength(1);
  const adjacent = await patchEmployee(f, moved, {
    branch_ids: [f.branch, f.sibling],
    branch_effective_date: '2026-10-15',
  });
  expect(adjacent).toMatchObject({ status: 200, body: { revision: 3 } });
  expect(
    await f.h
      .owner`SELECT "from"::text,"to"::text FROM employee_branches WHERE employee_id=${moved.id} AND branch_id=${f.branch} ORDER BY "from"`,
  ).toEqual([
    { from: '2026-01-01', to: '2026-10-15' },
    { from: '2026-10-15', to: null },
  ]);
});
it('two concurrent reattachments overlapping the closed interval both fail without overwriting history', async () => {
  const moved = await movedEmployee();
  const responses = await Promise.all(
    ['2026-10-10', '2026-10-14'].map((date) =>
      patchEmployee(f, moved, {
        branch_ids: [f.branch, f.sibling],
        branch_effective_date: date,
      }),
    ),
  );
  for (const response of responses)
    expect(response).toMatchObject({
      status: 409,
      body: { code: 'EMPLOYEE_BRANCH_HISTORY_OVERLAP' },
    });
  expect(await f.h.owner`SELECT revision FROM employees WHERE id=${moved.id}`).toEqual([
    { revision: 2 },
  ]);
  expect(
    await f.h.owner`SELECT id FROM employee_branches WHERE employee_id=${moved.id}`,
  ).toHaveLength(2);
});
it('maps a database exclusion violation to the named conflict and rolls back employee and audit writes', async () => {
  const moved = await movedEmployee();
  // نتجاوز خطة المجال عمداً لإثبات أن رفض قاعدة البيانات يصل كخطأ مسمى ولا يترك حفظاً جزئياً.
  await expect(
    f.updateTransactions.run({ companyId: f.company, userId: f.userId }, async (scope) => {
      const current = await scope.load(f.business, moved.id);
      if (current === null) throw new Error('Synthetic employee missing');
      await scope.save(
        current.record,
        {
          after: { ...current.record, revision: 3, branch_ids: [f.branch, f.sibling] },
          attach: [f.branch],
          detach: [],
          changed: true,
        },
        '2026-10-10',
        [{ id: ids.newId(), branchId: f.branch }],
      );
    }),
  ).rejects.toThrow('EMPLOYEE_BRANCH_HISTORY_OVERLAP');
  expect(await f.h.owner`SELECT revision FROM employees WHERE id=${moved.id}`).toEqual([
    { revision: 2 },
  ]);
  expect(
    await f.h.owner`SELECT id FROM audit_log WHERE entity_id=${moved.id} AND action='updated'`,
  ).toHaveLength(1);
});
it('loads closed and open history with the unchanged active detail shape and an indexed tenant lookup', async () => {
  const moved = await movedEmployee();
  const loaded = await f.db.withTenant(f.company, (tx) =>
    lockedEmployee(tx, f.company, f.business, moved.id),
  );
  expect(loaded?.record).toEqual(moved);
  expect(loaded?.history).toEqual(
    expect.arrayContaining([
      { id: expect.any(String), branchId: f.branch, from: '2026-01-01', to: '2026-10-15' },
      { id: expect.any(String), branchId: f.sibling, from: '2026-10-15', to: null },
    ]),
  );
  const plan = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) SELECT id,branch_id,"from","to" FROM employee_branches
      WHERE company_id=${f.company} AND employee_id=${moved.id} ORDER BY branch_id,"from"`);
  });
  expect(JSON.stringify(plan)).toMatch(/employee_branches_(company_employee_from_idx|no_overlap)/);
  expect(
    await f.db.withTenant(f.otherCompany, (tx) =>
      lockedEmployee(tx, f.otherCompany, f.business, moved.id),
    ),
  ).toBeNull();
});
