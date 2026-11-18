import { sellablePackageTypePage } from '@pospay/contracts';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { packageTypesFixture, packageTerms, type PackageFixture } from './package-types.fixture.ts';

const ids = systemUuidV7();
const roles = {
  branch_manager: '01920000-0000-7000-8000-000000000105',
  cashier: '01920000-0000-7000-8000-000000000107',
  waiter: '01920000-0000-7000-8000-000000000108',
  device: '01920000-0000-7000-8000-00000000010e',
} as const;
let f: PackageFixture;
let branch: string;
let secondBranch: string;
let foreignBranch: string;
let inactiveBranch: string;
let packageTypeId: string;

beforeAll(async () => {
  f = await packageTypesFixture();
  branch = ids.newId();
  secondBranch = ids.newId();
  foreignBranch = ids.newId();
  inactiveBranch = ids.newId();
  await f.h.owner`INSERT INTO branches(company_id,id,business_id,name_en,is_active) VALUES
    (${f.company},${branch},${f.business},'Synthetic picker branch',true),
    (${f.company},${secondBranch},${f.secondBusiness},'Synthetic foreign business branch',true),
    (${f.otherCompany},${foreignBranch},${f.foreignBusiness},'Synthetic foreign tenant branch',true),
    (${f.company},${inactiveBranch},${f.business},'Synthetic inactive branch',false)`;
  const created = await f.createPackage.execute({
    companyId: f.company,
    userId: f.userId,
    businessId: f.business,
    input: packageTerms(f, 'Picker HTTP'),
  });
  packageTypeId = created.id;
});

afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

async function assignRole(role: keyof typeof roles, scopeId = branch) {
  await f.h.owner`UPDATE memberships SET role_id=${roles[role]},role_owner_key='global',
    scope_type='BRANCH',scope_id=${scopeId} WHERE company_id=${f.company} AND id=${f.memberId}`;
  await f.h
    .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND membership_id=${f.memberId}`;
}

function request(businessId = f.business, branchId = branch, companyId = f.company) {
  return f.h.send(
    'GET',
    `/v1/businesses/${businessId}/branches/${branchId}/sellable-package-types`,
    {
      cookie: f.cookie,
      company: companyId,
    },
  );
}

it.each(['cashier', 'branch_manager'] as const)(
  'SA-12 default %s loads the picker with sell but without package-type read',
  async (role) => {
    await assignRole(role);
    const grants = await f.h.owner`SELECT permission_code FROM role_permissions
      WHERE role_owner_key='global' AND role_id=${roles[role]}
        AND permission_code IN ('sell:packages:branch','read:package-types:business')`;
    expect(grants.map((row) => row['permission_code'])).toEqual(['sell:packages:branch']);
    const response = await request();
    expect(response.status).toBe(200);
    expect(sellablePackageTypePage.parse(response.body).items.map((entry) => entry.id)).toContain(
      packageTypeId,
    );
  },
);

it.each(['waiter', 'device'] as const)(
  'SA-11 refuses a %s without sell authority',
  async (role) => {
    await assignRole(role);
    const response = await request();
    expect(response.status).toBe(403);
    expect(response.body['code']).toBe('FORBIDDEN');
  },
);

it('SA-11 refuses the picker when the orders feature is disabled', async () => {
  await assignRole('cashier');
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES(${f.company},'orders',false,'Synthetic picker feature off',${f.userId})`;
  try {
    const response = await request();
    expect(response.status).toBe(403);
    expect(response.body['code']).toBe('FEATURE_DISABLED');
  } finally {
    await f.h
      .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='orders'`;
  }
});

it('refuses wrong business, tenant, missing and inactive place pairs uniformly', async () => {
  await assignRole('cashier');
  const expected = (await request(f.business, secondBranch)).body;
  for (const response of [
    await request(f.secondBusiness, branch),
    await request(f.secondBusiness, secondBranch),
    await request(f.business, foreignBranch),
    await request(f.foreignBusiness, foreignBranch),
    await request(f.business, ids.newId()),
    await request(f.business, inactiveBranch),
    await request(f.business, branch, ids.newId()),
  ]) {
    expect(response.status).toBe(403);
    expect(response.body).toEqual(expected);
  }
});

it('a personal package-read grant never substitutes for branch sell permission', async () => {
  await assignRole('waiter');
  await f.h.owner`INSERT INTO permission_overrides
    (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${ids.newId()},${f.memberId},'read:package-types:business','ALLOW',
      'BUSINESS',${f.business},'Synthetic read only',${f.userId})`;
  expect((await request()).status).toBe(403);
});
