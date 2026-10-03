import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  createForUpdate,
  executeUpdate,
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

it('owner decision 2026-10-03: allows a future move with one shared exclusive/inclusive boundary', async () => {
  const original = await createForUpdate(f);
  const moved = await executeUpdate(f, original, {
    primary_branch_id: f.sibling,
    branch_ids: [f.sibling],
    branch_effective_date: '2999-10-15',
  });
  expect(moved).toMatchObject({
    revision: 2,
    primary_branch_id: f.sibling,
    branch_ids: [f.sibling],
  });
  // النهاية مستبعدة: لا نطرح يوماً من تاريخ انتقال المدير، وبداية الفرع الجديد تحمل اليوم نفسه.
  expect(
    await f.h
      .owner`SELECT branch_id,"from"::text,"to"::text FROM employee_branches WHERE employee_id=${original.id} ORDER BY "from"`,
  ).toEqual([
    { branch_id: f.branch, from: original.hire_date, to: '2999-10-15' },
    { branch_id: f.sibling, from: '2999-10-15', to: null },
  ]);
  const [audit] = await f.h
    .owner`SELECT before,after FROM audit_log WHERE entity_id=${original.id} AND action='updated'`;
  expect(audit?.['before']).toEqual(original);
  expect(audit?.['after']).toMatchObject({
    ...moved,
    branch_change: {
      effective_date: '2999-10-15',
      closed_attachment_ids: [expect.any(String)],
      attached: [{ id: expect.any(String), branchId: f.sibling }],
    },
  });
});
