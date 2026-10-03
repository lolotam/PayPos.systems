import { afterAll, beforeAll, expect, it } from 'vitest';
import { employeeUserMembership } from './employees.fixture.ts';
import {
  createForUpdate,
  executeUpdate,
  patchEmployee,
  updateEmployeeFixture,
  ids,
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
async function user() {
  const userId = ids.newId();
  await f.h
    .owner`INSERT INTO "user"(id,name,email) VALUES (${userId},'Synthetic employee user',${`${userId}@example.test`})`;
  return userId;
}
it('UE-02 links an active company member at another business, unlinks, and never edits access', async () => {
  const userId = await user();
  await employeeUserMembership(f, userId, { businessId: f.secondBusiness });
  const record = await createForUpdate(f);
  const membership = await f.h.owner`SELECT * FROM memberships WHERE user_id=${userId}`;
  const linked = await executeUpdate(f, record, { user_id: userId });
  expect(linked).toMatchObject({ user_id: userId, revision: 2 });
  const unlinked = await executeUpdate(f, linked, { user_id: null });
  expect(unlinked).toMatchObject({ user_id: null, revision: 3 });
  expect(await f.h.owner`SELECT * FROM memberships WHERE user_id=${userId}`).toEqual(membership);
  expect(
    await f.h
      .owner`SELECT before,after FROM audit_log WHERE entity_id=${record.id} AND action='updated' ORDER BY id`,
  ).toEqual([
    { before: record, after: linked },
    { before: linked, after: unlinked },
  ]);
});
it('unknown, foreign and inactive user links share exactly the same 400 with no audit', async () => {
  const record = await createForUpdate(f);
  const foreign = await user(),
    inactive = await user(),
    future = await user();
  await employeeUserMembership(f, foreign, { companyId: f.otherCompany });
  await employeeUserMembership(f, inactive, { endsAt: '2001-01-01T00:00:00Z' });
  await employeeUserMembership(f, future, { startsAt: '2999-01-01T00:00:00Z' });
  const unknown = await patchEmployee(f, record, { user_id: ids.newId() });
  expect(unknown).toMatchObject({ status: 400, body: { code: 'EMPLOYEE_USER_LINK_UNAVAILABLE' } });
  for (const userId of [foreign, inactive, future])
    expect(await patchEmployee(f, record, { user_id: userId })).toEqual(unknown);
  expect(await f.h.owner`SELECT revision,user_id FROM employees WHERE id=${record.id}`).toEqual([
    { revision: 1, user_id: null },
  ]);
  expect(
    await f.h.owner`SELECT id FROM audit_log WHERE entity_id=${record.id} AND action='updated'`,
  ).toHaveLength(0);
});
it('same-business concurrent links yield one success and one named 409, then unlink releases it', async () => {
  const userId = await user();
  await employeeUserMembership(f, userId);
  const a = await createForUpdate(f),
    b = await createForUpdate(f);
  const results = await Promise.all([
    patchEmployee(f, a, { user_id: userId }),
    patchEmployee(f, b, { user_id: userId }),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(results.find((r) => r.status === 409)?.body['code']).toBe('EMPLOYEE_USER_ALREADY_LINKED');
  const linked = results.find((r) => r.status === 200)?.body;
  const winner = linked?.['id'] === a.id ? a : b;
  const loser = winner.id === a.id ? b : a;
  await executeUpdate(f, { ...winner, revision: 2, user_id: userId }, { user_id: null });
  expect(await executeUpdate(f, loser, { user_id: userId })).toMatchObject({
    user_id: userId,
    revision: 2,
  });
});
