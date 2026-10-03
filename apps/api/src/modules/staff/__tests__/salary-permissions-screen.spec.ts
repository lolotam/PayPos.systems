import { afterAll, beforeAll, expect, it } from 'vitest';
import { salaryFixture, salaryIds, type SalaryFixture } from './salary.fixture.ts';
let f: SalaryFixture;
beforeAll(async () => {
  f = await salaryFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
it('PR 7 exposes salary codes and the owner can grant both personally without role defaults', async () => {
  await f.h.signedInOperator('synthetic-salary-editor@example.test');
  const [user] = await f.h
    .owner`SELECT id FROM "user" WHERE email='synthetic-salary-editor@example.test'`;
  const [role] = await f.h
    .owner`SELECT id FROM roles WHERE code='business_manager' AND company_id IS NULL`;
  const membership = salaryIds.newId();
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at) VALUES (${f.company},${membership},${user?.['id'] as string},${role?.['id'] as string},'global','BUSINESS',${f.business},'2000-01-01')`;
  const detail = await f.h.send('GET', `/v1/permissions/memberships/${membership}`, {
    cookie: f.cookie,
    company: f.company,
  });
  expect(detail.status).toBe(200);
  expect(detail.body['permission_catalog']).toEqual(
    expect.arrayContaining(['read:salaries:business', 'manage:salaries:business']),
  );
  expect(detail.body['role_defaults']).not.toContain('read:salaries:business');
  for (const permission of ['read:salaries:business', 'manage:salaries:business']) {
    const response = await f.h.send('POST', `/v1/permissions/memberships/${membership}/overrides`, {
      cookie: f.cookie,
      company: f.company,
      body: {
        permission_code: permission,
        effect: 'ALLOW',
        scope_type: 'BUSINESS',
        scope_id: f.business,
        reason: 'Synthetic salary delegation',
        expires_at: null,
      },
    });
    expect(response.status).toBe(201);
  }
  expect(
    await f.h
      .owner`SELECT permission_code FROM permission_overrides WHERE company_id=${f.company} AND membership_id=${membership}`,
  ).toHaveLength(2);
});
