import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  enrollFor,
  managerFor,
  requestFor,
  unbindFixture,
  type UnbindFixture,
} from './unbind-passkey.fixture.ts';
import { employeePasskeyHistory, passkeyEmployeePage } from '@pospay/contracts';
import { createManagerPasskeyAccess } from '../persistence/manager-passkey-access.adapter.ts';
import { managerPasskeyEmployee } from '../queries/passkey-access.ts';

let f: UnbindFixture;
beforeAll(async () => {
  f = await unbindFixture();
  await enrollFor(f);
});
afterAll(async () => {
  await f?.close();
});

it.each(['owner', 'general_manager', 'business_manager', 'branch_manager'])(
  'the default %s bundle can inspect and unbind only in scope',
  async (role) => {
    const scopeType =
      role === 'business_manager' ? 'BUSINESS' : role === 'branch_manager' ? 'BRANCH' : 'COMPANY';
    const scopeId =
      scopeType === 'BUSINESS' ? f.businessId : scopeType === 'BRANCH' ? f.branchId : f.companyId;
    const manager = await managerFor(f, role, scopeType, scopeId);
    const read = await requestFor(f, manager)('GET');
    expect(read.statusCode).toBe(200);
    const history = employeePasskeyHistory.parse(read.json());
    expect(history.can_unbind).toBe(true);
    const stale = await requestFor(f, manager)('POST', f.url + '/unbind', {
      binding_id: f.ids.newId(),
      revision: 1,
      reason: 'Synthetic stale binding',
    });
    expect(stale.statusCode).toBe(409);
    const list = await requestFor(f, manager)(
      'GET',
      `/v1/businesses/${f.businessId}/employee-passkeys`,
    );
    expect(passkeyEmployeePage.parse(list.json()).items.map((employee) => employee.id)).toContain(
      f.employeeId,
    );
  },
);

it('unknown, foreign and inaccessible employees share the same 404 even with a malformed body', async () => {
  const branch = f.ids.newId();
  await f.owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES(${f.companyId},${branch},${f.businessId},'Synthetic inaccessible branch')`;
  const manager = await managerFor(f, 'branch_manager', 'BRANCH', branch);
  const send = requestFor(f, manager);
  const known = await send('POST', f.url + '/unbind', {});
  const unknown = await send('POST', f.url.replace(f.employeeId, f.ids.newId()) + '/unbind', {});
  expect(known.statusCode).toBe(404);
  expect(unknown.statusCode).toBe(404);
  expect(known.json()).toEqual(unknown.json());
  const read = await send('GET');
  expect(read.statusCode).toBe(404);
  expect(read.json()).toEqual(
    (await send('GET', f.url.replace(f.employeeId, f.ids.newId()))).json(),
  );
  const foreignBusiness = f.ids.newId(),
    foreignBranch = f.ids.newId(),
    foreignEmployee = f.ids.newId();
  await f.owner`INSERT INTO businesses(company_id,id,name_en,vertical_type) VALUES(${f.otherCompany},${foreignBusiness},'Synthetic foreign','salon')`;
  await f.owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES(${f.otherCompany},${foreignBranch},${foreignBusiness},'Synthetic foreign')`;
  await f.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,role_code,hire_date) VALUES(${f.otherCompany},${foreignEmployee},${foreignBusiness},${foreignBranch},'Synthetic foreign','staff','2026-01-01')`;
  const foreign = await requestFor(f)(
    'POST',
    f.url.replace(f.employeeId, foreignEmployee) + '/unbind',
    {},
  );
  expect(foreign.statusCode).toBe(404);
  expect(foreign.json()).toEqual(unknown.json());
});

it('a business manager of another business sees the employee exactly like an unknown one', async () => {
  const business = f.ids.newId();
  await f.owner`INSERT INTO businesses(company_id,id,name_en,vertical_type) VALUES(${f.companyId},${business},'Synthetic sibling business','salon')`;
  const send = requestFor(f, await managerFor(f, 'business_manager', 'BUSINESS', business));
  const unknown = await send('POST', f.url.replace(f.employeeId, f.ids.newId()) + '/unbind', {});
  for (const response of [await send('GET'), await send('POST', f.url + '/unbind', {})]) {
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual(unknown.json());
  }
  const list = await send('GET', `/v1/businesses/${f.businessId}/employee-passkeys`);
  expect(passkeyEmployeePage.parse(list.json()).items).toEqual([]);
});

it('a shared employee requires every open branch and revoked membership is rechecked', async () => {
  const manager = await managerFor(f, 'branch_manager', 'BRANCH', f.branchId);
  const branch = f.ids.newId(),
    attachment = f.ids.newId();
  await f.owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES(${f.companyId},${branch},${f.businessId},'Synthetic shared branch')`;
  await f.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from") VALUES(${f.companyId},${attachment},${f.businessId},${f.employeeId},${branch},'2026-01-01')`;
  expect((await requestFor(f, manager)('GET')).statusCode).toBe(404);
  const list = await requestFor(f, manager)(
    'GET',
    `/v1/businesses/${f.businessId}/employee-passkeys`,
  );
  expect(passkeyEmployeePage.parse(list.json()).items).toEqual([]);
  await f.owner`UPDATE employee_branches SET "to"='2026-01-02' WHERE id=${attachment}`;
  expect((await requestFor(f, manager)('GET')).statusCode).toBe(200);
  await f.owner`UPDATE memberships SET ends_at=clock_timestamp() WHERE id=${manager.membershipId}`;
  const revoked = await requestFor(f, manager)('GET');
  expect(revoked.statusCode).toBe(403);
  expect(revoked.json().code).toBe('FORBIDDEN');
});

it('an attachment ending in the future still counts until its end date in the branch timezone', async () => {
  const branch = f.ids.newId(),
    attachment = f.ids.newId();
  await f.owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES(${f.companyId},${branch},${f.businessId},'Synthetic leaving branch')`;
  await f.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from","to")
    VALUES(${f.companyId},${attachment},${f.businessId},${f.employeeId},${branch},'2026-01-01',CURRENT_DATE+30)`;
  const localManager = await managerFor(f, 'branch_manager', 'BRANCH', f.branchId);
  const local = requestFor(f, localManager);
  const unknown = await local('POST', f.url.replace(f.employeeId, f.ids.newId()) + '/unbind', {});
  for (const response of [await local('GET'), await local('POST', f.url + '/unbind', {})]) {
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual(unknown.json());
  }
  const selector = `/v1/businesses/${f.businessId}/employee-passkeys`;
  expect(passkeyEmployeePage.parse((await local('GET', selector)).json()).items).toEqual([]);
  const [active] =
    await f.owner`SELECT id,revision FROM employee_passkeys WHERE employee_id=${f.employeeId} AND unbound_at IS NULL`;
  await expect(
    f.unbind.execute(
      { ...f.scope, userId: localManager.userId },
      {
        binding_id: String(active?.['id']),
        revision: Number(active?.['revision']),
        reason: 'Synthetic early detach',
      },
    ),
  ).rejects.toThrow('NOT_FOUND');
  const leaving = await managerFor(f, 'branch_manager', 'BRANCH', branch);
  await f.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    SELECT ${f.companyId},${f.ids.newId()},${leaving.userId},id,'global','BRANCH',${f.branchId} FROM roles WHERE company_id IS NULL AND code='branch_manager'`;
  const read = await requestFor(f, leaving)('GET');
  expect(read.statusCode).toBe(200);
  expect(employeePasskeyHistory.parse(read.json()).can_unbind).toBe(true);
  const list = await requestFor(f, leaving)('GET', selector);
  expect(passkeyEmployeePage.parse(list.json()).items.map((item) => item.id)).toContain(
    f.employeeId,
  );
  const [end] =
    await f.owner`SELECT ("to"::timestamp AT TIME ZONE COALESCE(b.timezone,bu.timezone)) AS at
    FROM employee_branches eb JOIN branches b ON b.company_id=eb.company_id AND b.id=eb.branch_id
    JOIN businesses bu ON bu.company_id=b.company_id AND bu.id=b.business_id WHERE eb.id=${attachment}`;
  const boundary = new Date(String(end?.['at'])).getTime();
  // النهاية مستبعدة: آخر لحظة قبل منتصف ليل الفرع ما زالت ضمن الارتباط، ومنتصف الليل خارجه.
  const decide = (at: number) =>
    f.database.withTenant(f.companyId, (tx) =>
      managerPasskeyEmployee(
        tx,
        { ...f.scope, userId: localManager.userId },
        createManagerPasskeyAccess({ now: () => new Date(at) }),
      ),
    );
  expect(await decide(boundary - 1)).toBeNull();
  expect(await decide(boundary)).toMatchObject({ unbindAllowed: true });
});

it('the manager who registered the active binding cannot unbind it after the employee is relinked', async () => {
  const manager = await managerFor(f, 'owner', 'COMPANY', f.companyId);
  const [active] =
    await f.owner`SELECT id,bound_by FROM employee_passkeys WHERE employee_id=${f.employeeId} AND unbound_at IS NULL`;
  // يحاكي تسجيلاً تم والمدير مرتبط بالموظف، ثم أعيد ربط الموظف بمستخدم آخر.
  await f.owner`UPDATE employee_passkeys SET bound_by=${manager.userId} WHERE id=${active?.['id']}`;
  try {
    const send = requestFor(f, manager);
    const history = employeePasskeyHistory.parse((await send('GET')).json());
    expect(history.can_unbind).toBe(false);
    const result = await send('POST', f.url + '/unbind', {
      binding_id: String(history.status.binding_id),
      revision: Number(history.status.revision),
      reason: 'Synthetic relinked self service',
    });
    expect(result.statusCode).toBe(403);
    expect(result.json().code).toBe('PASSKEY_SELF_UNBIND');
    await expect(
      f.unbind.execute(
        { ...f.scope, userId: manager.userId },
        {
          binding_id: String(history.status.binding_id),
          revision: Number(history.status.revision),
          reason: 'Synthetic relinked self service',
        },
      ),
    ).rejects.toThrow('PASSKEY_SELF_UNBIND');
  } finally {
    await f.owner`UPDATE employee_passkeys SET bound_by=${active?.['bound_by']} WHERE id=${active?.['id']}`;
  }
});

it('a manager cannot unbind their own binding, even with company owner authority', async () => {
  await f.owner`UPDATE employees SET user_id=${f.manager.userId} WHERE id=${f.employeeId}`;
  const send = requestFor(f);
  const history = employeePasskeyHistory.parse((await send('GET')).json());
  expect(history.can_unbind).toBe(false);
  const body = {
    binding_id: String(history.status.binding_id),
    revision: Number(history.status.revision),
    reason: 'Synthetic self service',
  };
  const result = await send('POST', f.url + '/unbind', body);
  expect(result.statusCode).toBe(403);
  expect(result.json().code).toBe('PASSKEY_SELF_UNBIND');
  await f.owner`UPDATE employees SET user_id=${f.userId} WHERE id=${f.employeeId}`;
});

it('Device and staff never inherit manager authority from a legacy ALLOW override', async () => {
  for (const role of ['device', 'staff']) {
    const member = await managerFor(f, role, 'BRANCH', f.branchId);
    const creation = await requestFor(f)(
      'POST',
      `/v1/permissions/memberships/${member.membershipId}/overrides`,
      {
        permission_code: 'unbind:passkeys:branch',
        effect: 'ALLOW',
        scope_type: 'BRANCH',
        scope_id: f.branchId,
        reason: 'Synthetic forbidden delegation',
        expires_at: null,
      },
    );
    expect(creation.statusCode).toBe(403);
    expect(creation.json().code).toBe('PERMISSION_ROLE_FORBIDDEN');
    for (const permission of ['read:passkeys:branch', 'unbind:passkeys:branch'])
      await f.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
        VALUES(${f.companyId},${f.ids.newId()},${member.membershipId},${permission},'ALLOW','BRANCH',${f.branchId},'Synthetic legacy override',${f.manager.userId})`;
    expect((await requestFor(f, member)('GET')).statusCode).toBe(404);
    expect((await requestFor(f, member)('POST', f.url + '/unbind', {})).statusCode).toBe(404);
  }
});

it('malformed broad manager memberships and cross-branch overrides cannot expand scope', async () => {
  for (const role of ['business_manager', 'branch_manager']) {
    const member = await managerFor(f, role, 'COMPANY', f.companyId);
    expect((await requestFor(f, member)('GET')).statusCode).toBe(404);
  }
  const branch = f.ids.newId();
  await f.owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES(${f.companyId},${branch},${f.businessId},'Synthetic other branch')`;
  const member = await managerFor(f, 'branch_manager', 'BRANCH', branch);
  for (const permission of ['read:passkeys:branch', 'unbind:passkeys:branch'])
    await f.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
      VALUES(${f.companyId},${f.ids.newId()},${member.membershipId},${permission},'ALLOW','BRANCH',${f.branchId},'Synthetic broad grant',${f.manager.userId})`;
  expect((await requestFor(f, member)('GET')).statusCode).toBe(404);
});
