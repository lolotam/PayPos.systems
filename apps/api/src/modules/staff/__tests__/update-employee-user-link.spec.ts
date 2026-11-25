import { afterAll, beforeAll, expect, it } from 'vitest';
import { SYSTEM_ROLES } from '@pospay/db';
import { employeeUserMembership } from './employees.fixture.ts';
import {
  createForUpdate,
  executeUpdate,
  patchEmployee,
  updateEmployeeFixture,
  ids,
  type UpdateFixture,
} from './update-employee.fixture.ts';
const staffRoleId = (SYSTEM_ROLES.find((role) => role.code === 'staff') as { id: string }).id;
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
/**
 * سجل «إعطاء دخول» اصطناعي بحالة محددة؛ PENDING وCANCELLING وPHONE_CHANGING يمنعان نقل الموظفة لفرع
 * تاني. الحالات المستقرة وتغيير الهاتف تأخذ مستخدم موظفة وعضوية فرع خاصين بها لا عضوية المالك:
 * نقل الفرع بينهي العضوية، وإنهاء عضوية المالك الوحيدة بيكسر قاعدة «آخر مالك».
 */
async function staffAccessRow(
  fixture: UpdateFixture,
  employeeId: string,
  state: 'PENDING' | 'CANCELLING' | 'PHONE_CHANGING' | 'ACTIVE' | 'STOPPED',
) {
  const id = ids.newId();
  const hasUser = state === 'ACTIVE' || state === 'STOPPED' || state === 'PHONE_CHANGING';
  const hasMembership = state === 'ACTIVE' || state === 'PHONE_CHANGING';
  const staffUser = hasUser ? await user() : null;
  const membershipId = ids.newId();
  if (staffUser !== null)
    await fixture.h.owner`INSERT INTO memberships
      (company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at,ends_at)
      VALUES (${fixture.company},${membershipId},${staffUser},${staffRoleId},'global','BRANCH',
        ${fixture.branch},now() - interval '1 hour',
        ${state === 'STOPPED' ? new Date(Date.now() - 60_000).toISOString() : null})`;
  await fixture.h.owner`INSERT INTO employee_staff_access
    (company_id,id,business_id,employee_id,operation_id,role_code,branch_id,state,granted_by,phone_hash,attempt_id,
      user_id,membership_id)
    VALUES (${fixture.company},${id},${fixture.business},${employeeId},${ids.newId()},'staff',${fixture.branch},${state},
      ${fixture.userId},${'a'.repeat(64)},${ids.newId()},${staffUser},
      ${hasMembership ? membershipId : null})`;
  return id;
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
it('AC-ACT-12 refuses a primary-branch change while a grant, cancel or phone change is pending', async () => {
  for (const state of ['PENDING', 'CANCELLING', 'PHONE_CHANGING'] as const) {
    const record = await createForUpdate(f);
    const accessId = await staffAccessRow(f, record.id, state);
    const response = await patchEmployee(f, record, {
      primary_branch_id: f.sibling,
      branch_ids: [f.sibling],
    });
    expect(response).toMatchObject({
      status: 409,
      body: { code: 'STAFF_ACCESS_PENDING_BRANCH_CHANGE' },
    });
    expect(
      await f.h.owner`SELECT primary_branch_id,revision FROM employees WHERE id=${record.id}`,
    ).toEqual([{ primary_branch_id: f.branch, revision: 1 }]);
    expect(
      await f.h.owner`SELECT state,branch_id FROM employee_staff_access WHERE id=${accessId}`,
    ).toEqual([{ state, branch_id: f.branch }]);
    expect(
      await f.h.owner`SELECT id FROM audit_log WHERE entity_id=${record.id} AND action='updated'`,
    ).toHaveLength(0);
  }
});
it('AC-ACT-12 allows the primary-branch change when the access record is settled', async () => {
  for (const state of ['ACTIVE', 'STOPPED'] as const) {
    const record = await createForUpdate(f);
    await staffAccessRow(f, record.id, state);
    expect(
      await patchEmployee(f, record, {
        primary_branch_id: f.sibling,
        branch_ids: [f.sibling],
      }),
    ).toMatchObject({
      status: 200,
      body: { primary_branch_id: f.sibling, revision: 2 },
    });
  }
});
it('AC-ACT-12 allows any other field while a grant is pending', async () => {
  const record = await createForUpdate(f);
  await staffAccessRow(f, record.id, 'PENDING');
  expect(await patchEmployee(f, record, { name_en: 'Renamed while pending' })).toMatchObject({
    status: 200,
    body: { name_en: 'Renamed while pending', revision: 2 },
  });
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
