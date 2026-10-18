import { afterAll, beforeAll, expect, it } from 'vitest';
import { employeeNumbering } from '@pospay/contracts';
import { createSetEmployeeNumberStartTransactions } from '../persistence/set-employee-number-start.adapter.ts';
import { SetEmployeeNumberStartUseCase } from '../use-cases/set-employee-number-start/set-employee-number-start.usecase.ts';
import { numberDevice } from './set-employee-number.fixture.ts';
import {
  clearNumberGrants,
  devicePut,
  employeeNumberIds,
  expectOwnerAudit,
  getNumbering,
  grantNumber,
  numberFixture,
  putStart,
  readCounter,
  startAudits,
  withoutStaff,
  type EmployeeFixture,
} from './set-employee-number-start.fixture.ts';

const clock = { now: () => new Date('2026-10-18T12:00:00.000Z') };

let f: EmployeeFixture;
beforeAll(async () => {
  f = await numberFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it('refuses a user with no number grant before any counter row', async () => {
  await expect(executeStart(f, 10)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expectUntouched(f);
});

it('refuses a company-scope DENY before any counter row', async () => {
  await grantNumber(f, 'ALLOW', 'COMPANY', f.company);
  await grantNumber(f, 'DENY', 'COMPANY', f.company);
  try {
    await expect(executeStart(f, 20)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expectUntouched(f);
  } finally {
    await clearNumberGrants(f);
  }
});

it('refuses the start when the staff feature is off', async () => {
  await grantNumber(f, 'ALLOW', 'COMPANY', f.company);
  try {
    await withoutStaff(f, async () => {
      await expect(executeStart(f, 30)).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
    });
    await expectUntouched(f);
  } finally {
    await clearNumberGrants(f);
  }
});

it('allows a company start when the only DENY is business-scoped', async () => {
  const company = await memberCompany(f);
  await grantOn(f, company, 'ALLOW', 'COMPANY', company.companyId);
  await grantOn(f, company, 'DENY', 'BUSINESS', company.businessId);
  const set = await executeStart(f, 80, company.companyId);
  expect(set).toMatchObject({ next_number: 80, start_number: 80, can_manage: false });
  expect(await startAudits(f, company.companyId)).toHaveLength(1);
});

it('refuses PUT and GET when the caller holds no number grant', async () => {
  expect((await putStart(f, { start_number: 10 })).status).toBe(403);
  expect((await getNumbering(f)).status).toBe(403);
  await expectUntouched(f);
});

it('refuses a device start', async () => {
  const device = await devicePut(f, await numberDevice(f), { start_number: 11 });
  expect(device.status).toBe(403);
  await expectUntouched(f);
});

it('returns FEATURE_DISABLED when staff is off and leaves the counter unset', async () => {
  await withoutStaff(f, async () => {
    const disabled = await putStart(f, { start_number: 12 }, { cookie: f.ownerCookie });
    expect(disabled.body['code']).toBe('FEATURE_DISABLED');
  });
  await expectUntouched(f);
});

it('records the owner start and returns the same read', async () => {
  const ownerCompany = await f.h.onboard(f.ownerCookie, 'EN-11 owner');
  const owner = await putStart(f, { start_number: 40 }, { cookie: f.ownerCookie, company: ownerCompany });
  expect(owner.status).toBe(200);
  await expectOwnerAudit(f, ownerCompany, owner.body);
});

it('allows a person granted the company permission', async () => {
  await grantNumber(f, 'ALLOW', 'COMPANY', f.company);
  try {
    const granted = await putStart(f, { start_number: 70 });
    expect(granted.status).toBe(200);
    expect(employeeNumbering.parse(granted.body).can_manage).toBe(false);
  } finally {
    await clearNumberGrants(f);
  }
});

function executeStart(fixture: EmployeeFixture, startNumber: number, companyId = fixture.company) {
  const useCase = new SetEmployeeNumberStartUseCase(
    createSetEmployeeNumberStartTransactions(fixture.db, employeeNumberIds),
    clock,
  );
  return useCase.execute({ companyId, userId: fixture.userId, startNumber });
}

async function expectUntouched(fixture: EmployeeFixture, companyId = fixture.company) {
  expect(await readCounter(fixture, companyId)).toBeNull();
  expect(await startAudits(fixture, companyId)).toEqual([]);
}

async function memberCompany(fixture: EmployeeFixture) {
  const companyId = await fixture.h.onboard(fixture.ownerCookie, 'start business deny');
  const businessId = employeeNumberIds.newId();
  const roleId = employeeNumberIds.newId();
  const membershipId = employeeNumberIds.newId();
  await fixture.h.owner`INSERT INTO businesses (company_id,id,name_en,vertical_type)
    VALUES (${companyId},${businessId},'Start deny business','salon')`;
  await fixture.h.owner`INSERT INTO roles(id,company_id,code,name_en)
    VALUES (${roleId},${companyId},'synthetic_number_member','Synthetic number member')`;
  await fixture.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${companyId},${membershipId},${fixture.userId},${roleId},${companyId},'COMPANY',${companyId})`;
  return { companyId, businessId, membershipId };
}

function grantOn(
  fixture: EmployeeFixture,
  company: { companyId: string; membershipId: string },
  effect: 'ALLOW' | 'DENY',
  scopeType: 'COMPANY' | 'BUSINESS',
  scopeId: string,
) {
  return fixture.h.owner`INSERT INTO permission_overrides
    (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${company.companyId},${employeeNumberIds.newId()},${company.membershipId},'manage:employee-number:company',${effect},${scopeType},${scopeId},'Synthetic grant',${fixture.userId})`;
}
