import { afterAll, beforeAll, expect, it } from 'vitest';
import { employeeUserMembership } from './employees.fixture.ts';
import { salaryFixture, salaryCommand, salaryIds, type SalaryFixture } from './salary.fixture.ts';
let f: SalaryFixture;
beforeAll(async () => {
  f = await salaryFixture();
  await f.set.execute(salaryCommand(f));
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const read = (path = f.path) => f.h.send('GET', path, { cookie: f.cookie, company: f.company });
async function override(
  permission: string,
  effect: string,
  expiresAt: string | null = null,
  scope = 'BUSINESS',
  scopeId = f.business,
) {
  await f.h
    .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by,expires_at) VALUES (${f.company},${salaryIds.newId()},${f.memberId},${permission},${effect},${scope},${scopeId},'Synthetic salary access',${f.userId},${expiresAt})`;
}
it('default owner access has no role bundle and HTTP requires an idempotency key', async () => {
  expect((await read()).status).toBe(200);
  expect(
    await f.h
      .owner`SELECT * FROM role_permissions WHERE permission_code IN ('read:salaries:business','manage:salaries:business')`,
  ).toHaveLength(0);
  const result = await f.h.send('POST', f.path, {
    cookie: f.cookie,
    company: f.company,
    body: salaryCommand(f).input,
  });
  expect(result.body['code']).toBe('IDEMPOTENCY_KEY_REQUIRED');
});
it('DENY wins for a delegated nonowner at persisted branch and matches missing/foreign business', async () => {
  const [manager] = await f.h
    .owner`SELECT id FROM roles WHERE code='business_manager' AND company_id IS NULL`;
  await f.h
    .owner`UPDATE memberships SET role_id=${manager?.['id'] as string},role_owner_key='global' WHERE company_id=${f.company} AND id=${f.memberId}`;
  await override('read:salaries:business', 'ALLOW');
  await override('manage:salaries:business', 'ALLOW');
  await override('read:salaries:business', 'DENY', null, 'BRANCH', f.branch);
  const denied = await read();
  const missing = await read(
    `/v1/businesses/${f.business}/employees/${salaryIds.newId()}/salaries`,
  );
  const foreign = await read(
    `/v1/businesses/${f.secondBusiness}/employees/${f.employee.id}/salaries`,
  );
  expect(denied.status).toBe(404);
  expect(denied.body).toEqual(missing.body);
  expect(denied.body).toEqual(foreign.body);
  await f.h
    .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND membership_id=${f.memberId} AND permission_code IN ('read:salaries:business','manage:salaries:business')`;
});
it('nonowner role grants do not grant salary; explicit branch personal ALLOW does', async () => {
  await f.h.signedInOperator('synthetic-backup-owner@example.test');
  const [backup] = await f.h
    .owner`SELECT id FROM "user" WHERE email='synthetic-backup-owner@example.test'`;
  await employeeUserMembership(f, backup?.['id'] as string);
  const [role] = await f.h
    .owner`SELECT id FROM roles WHERE code='business_manager' AND company_id IS NULL`;
  await f.h
    .owner`UPDATE memberships SET role_id=${role?.['id'] as string} WHERE company_id=${f.company} AND id=${f.memberId}`;
  await f.h
    .owner`INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code) VALUES (${role?.['id'] as string},'global',NULL,'read:salaries:business')`;
  expect((await read()).status).toBe(404);
  await override('read:salaries:business', 'ALLOW', '2000-01-01');
  expect((await read()).status).toBe(404);
  await override('read:salaries:business', 'ALLOW', null, 'BRANCH', f.branch);
  expect((await read()).body['can_manage']).toBe(false);
  await override('manage:salaries:business', 'ALLOW', null, 'BRANCH', f.branch);
  const result = await f.h.send('POST', f.path, {
    cookie: f.cookie,
    company: f.company,
    key: salaryIds.newId(),
    body: salaryCommand(f, '200.000').input,
  });
  expect(result.status).toBe(200);
  expect(result.body['revision']).toBe(2);
});
it('manage-only cannot read or infer salary existence, expired grants fail, disabled feature follows allowed access', async () => {
  await f.h
    .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND membership_id=${f.memberId} AND permission_code='read:salaries:business'`;
  const denied = await f.h.send('POST', f.path, {
    cookie: f.cookie,
    company: f.company,
    key: salaryIds.newId(),
    body: salaryCommand(f).input,
  });
  const missing = await f.h.send(
    'POST',
    `/v1/businesses/${f.business}/employees/${salaryIds.newId()}/salaries`,
    { cookie: f.cookie, company: f.company, key: salaryIds.newId(), body: salaryCommand(f).input },
  );
  expect(denied.body).toEqual(missing.body);
  expect(denied.status).toBe(404);
  await override('read:salaries:business', 'ALLOW');
  await f.h
    .owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by) VALUES (${f.company},'staff',false,'Synthetic decision',${f.userId})`;
  expect((await read()).body['code']).toBe('FEATURE_DISABLED');
});
