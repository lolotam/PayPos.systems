import { afterAll, beforeAll, expect, it } from 'vitest';
import { OWNER_ROLE_ID } from '@pospay/db';
import {
  permissionFixture,
  newHeldMember,
  newMember,
  save,
  type PermissionFixture,
} from './permissions-screen.fixture.ts';

let f: PermissionFixture;
let target: string;
beforeAll(async () => {
  f = await permissionFixture();
  target = await newMember(f, 'cashier');
  for (const permission_code of ['manage:memberships:company', 'read:files:business']) {
    expect((await save(f, f.managerMember, { permission_code })).status).toBe(201);
  }
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it.each([
  ['future owner', 'COMPANY', '2999-01-01', null],
  ['ended owner', 'COMPANY', '2000-01-01', '2001-01-01'],
  ['business-scoped owner', 'BUSINESS', '2000-01-01', null],
] as const)(
  'ODOC-07: %s is not an active canonical company owner',
  async (_name, scope, starts, ends) => {
    const sibling = await newHeldMember(f, { userId: f.managerId }, 'owner');
    await f.h
      .owner`UPDATE memberships SET scope_type=${scope},scope_id=${scope === 'COMPANY' ? f.company : f.business},
    starts_at=${starts},ends_at=${ends} WHERE company_id=${f.company} AND id=${sibling}`;
    try {
      const response = await save(
        f,
        target,
        { permission_code: 'read:files:business' },
        f.managerCookie,
      );
      expect(response.status).toBe(403);
      expect(response.body['code']).toBe('PERMISSION_OWNER_ONLY');
    } finally {
      await f.h.owner`DELETE FROM memberships WHERE company_id=${f.company} AND id=${sibling}`;
    }
  },
);

it('ODOC-07: an owner membership in another company cannot grant this company files', async () => {
  const sibling = await newHeldMember(f, { userId: f.managerId }, 'owner', f.otherCompany);
  try {
    const response = await save(
      f,
      target,
      { permission_code: 'read:files:business' },
      f.managerCookie,
    );
    expect(response.body['code']).toBe('PERMISSION_OWNER_ONLY');
  } finally {
    await f.h.owner`DELETE FROM memberships WHERE company_id=${f.otherCompany} AND id=${sibling}`;
  }
});

it('ODOC-07: a custom role named owner confers no owner-only granting authority', async () => {
  const role = f.ids.newId();
  const sibling = f.ids.newId();
  await f.h.owner`INSERT INTO roles(id,company_id,code,name_en)
    VALUES (${role},${f.company},'owner','Synthetic custom owner')`;
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${f.company},${sibling},${f.managerId},${role},${f.company},'COMPANY',${f.company})`;
  try {
    const response = await save(
      f,
      target,
      { permission_code: 'read:files:business' },
      f.managerCookie,
    );
    expect(response.body['code']).toBe('PERMISSION_OWNER_ONLY');
  } finally {
    await f.h.owner`DELETE FROM memberships WHERE company_id=${f.company} AND id=${sibling}`;
  }
});

it('ODOC-07: a live canonical owner sibling authorizes and is rechecked after ending', async () => {
  const sibling = await newHeldMember(f, { userId: f.managerId }, 'owner');
  expect(
    (await save(f, target, { permission_code: 'read:files:business' }, f.managerCookie)).status,
  ).toBe(201);
  await f.h.owner`UPDATE memberships SET ends_at=clock_timestamp()
    WHERE company_id=${f.company} AND id=${sibling} AND role_id=${OWNER_ROLE_ID}`;
  const refused = await save(
    f,
    target,
    { permission_code: 'read:files:business' },
    f.managerCookie,
  );
  expect(refused.body['code']).toBe('PERMISSION_OWNER_ONLY');
});
