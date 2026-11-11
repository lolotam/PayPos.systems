import { afterAll, beforeAll, expect, it } from 'vitest';
import { SYSTEM_ROLES } from '@pospay/db';
import { seedReferenceData } from '../../../../../../packages/db/src/seed.ts';
import { createAccessReader } from '../persistence/access-reader.ts';
import { AuthorizeRequest } from '../use-cases/authorize-request/authorize-request.ts';
import {
  newMember,
  permissionFixture,
  seedOverride,
  terms,
  type PermissionFixture,
} from './permissions-screen.fixture.ts';

const code = 'manage:imported-refunds:business';
let f: PermissionFixture;
beforeAll(async () => {
  f = await permissionFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
function role(name: string) {
  const found = SYSTEM_ROLES.find((r) => r.code === name);
  if (found === undefined) throw new Error(`Missing fixture role: ${name}`);
  return found.id;
}
const path = (business: boolean, member: string) =>
  `${business ? `/v1/businesses/${f.business}/permissions` : '/v1/permissions'}/memberships/${member}/overrides`;
function send(
  business: boolean,
  member: string,
  cookie: string,
  effect: 'ALLOW' | 'DENY',
  revokeId?: string,
) {
  return f.h.send(
    'POST',
    path(business, member) + (revokeId === undefined ? '' : `/${revokeId}/revoke`),
    {
      cookie,
      company: f.company,
      body:
        revokeId === undefined
          ? terms(f, {
              permission_code: code,
              effect,
              scope_type: 'BUSINESS',
              scope_id: f.business,
            })
          : { reason: 'Synthetic revoke' },
    },
  );
}
async function state() {
  return {
    overrides: await f.h
      .owner`SELECT * FROM permission_overrides WHERE company_id=${f.company} ORDER BY id`,
    audit: await f.h.owner`SELECT * FROM audit_log WHERE company_id=${f.company} ORDER BY id`,
  };
}
async function target(kind: string) {
  const member = await newMember(f, kind);
  await f.h.owner`UPDATE memberships SET scope_type='BUSINESS',scope_id=${f.business}
    WHERE company_id=${f.company} AND id=${member}`;
  return member;
}
function authorize() {
  return new AuthorizeRequest(createAccessReader(f.db)).execute({
    userId: f.managerId,
    requestedCompany: f.company,
    permission: code,
    businessParam: f.business,
  });
}

it('G seed remains inactive and pre-S catalog rejects the future code without writes', async () => {
  await seedReferenceData(f.h.urls.owner);
  expect(await f.h.owner`SELECT code FROM permissions WHERE code=${code}`).toHaveLength(0);
  expect(
    await f.h.owner`SELECT permission_code FROM role_permissions WHERE permission_code=${code}`,
  ).toHaveLength(0);
  const member = await target('staff');
  for (const business of [false, true]) {
    const before = await state();
    for (const effect of ['ALLOW', 'DENY'] as const) {
      expect((await send(business, member, f.cookie, effect)).status).toBe(403);
      expect(await state()).toEqual(before);
    }
  }
});

it('post-S owner SAVE ALLOW/DENY and REVOKE work for global staff and custom humans on both routes', async () => {
  await f.h.owner`INSERT INTO permissions(code) VALUES (${code})`;
  await f.h.owner`INSERT INTO role_permissions(role_id,role_owner_key,permission_code)
    VALUES (${role('owner')},'global',${code})`;
  await seedReferenceData(f.h.urls.owner);
  expect(
    await f.h.owner`SELECT permission_code FROM role_permissions WHERE permission_code=${code}`,
  ).toHaveLength(1);
  for (const kind of ['staff', 'synthetic_viewer']) {
    for (const business of [false, true]) {
      const member = await target(kind);
      for (const effect of ['ALLOW', 'DENY'] as const) {
        const saved = await send(business, member, f.cookie, effect);
        expect(saved.status).toBe(201);
        expect(
          (await send(business, member, f.cookie, effect, saved.body['id'] as string)).status,
        ).toBe(200);
      }
    }
  }
});

it('owner grants remain readable on G for every global human role and custom role', async () => {
  for (const name of [
    ...SYSTEM_ROLES.filter((r) => !['device', 'owner'].includes(r.code)).map((r) => r.code),
    'custom',
  ]) {
    if (name === 'custom') {
      const [custom] = await f.h
        .owner`SELECT id FROM roles WHERE company_id=${f.company} AND code='synthetic_editor'`;
      if (custom === undefined) throw new Error('Missing custom fixture role');
      await f.h.owner`UPDATE memberships SET role_id=${custom['id']},role_owner_key=${f.company}
        WHERE company_id=${f.company} AND id=${f.managerMember}`;
    } else {
      await f.h.owner`UPDATE memberships SET role_id=${role(name)},role_owner_key='global'
        WHERE company_id=${f.company} AND id=${f.managerMember}`;
    }
    await f.h
      .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND membership_id=${f.managerMember}`;
    const granted = await send(false, f.managerMember, f.cookie, 'ALLOW');
    expect(granted.status).toBe(201);
    expect(await authorize()).not.toBeNull();
    expect(
      (await send(false, f.managerMember, f.cookie, 'ALLOW', granted.body['id'] as string)).status,
    ).toBe(200);
    expect(await authorize()).toBeNull();
  }
});

it('a human grantee with management authority cannot SAVE ALLOW/DENY or REVOKE; refusal leaves rows and audit intact', async () => {
  const [editor] = await f.h
    .owner`SELECT id FROM roles WHERE company_id=${f.company} AND code='synthetic_editor'`;
  if (editor === undefined) throw new Error('Missing custom editor role');
  await f.h.owner`UPDATE memberships SET role_id=${editor['id']},role_owner_key=${f.company}
    WHERE company_id=${f.company} AND id=${f.managerMember}`;
  for (const permission_code of [code, 'manage:memberships:company', 'manage:memberships:business'])
    await seedOverride(f, f.managerMember, { permission_code });
  for (const permission of ['manage:memberships:company', 'manage:memberships:business', code]) {
    const authorization = await new AuthorizeRequest(createAccessReader(f.db)).execute({
      userId: f.managerId,
      requestedCompany: f.company,
      permission,
      ...(permission.endsWith(':business') ? { businessParam: f.business } : {}),
    });
    expect(authorization).not.toBeNull();
  }
  for (const business of [false, true]) {
    for (const kind of ['staff', 'synthetic_viewer']) {
      const member = await target(kind);
      for (const effect of ['ALLOW', 'DENY'] as const) {
        const existing = await seedOverride(f, member, {
          permission_code: code,
          effect,
          scope_type: 'BUSINESS',
          scope_id: f.business,
        });
        for (const revokeId of [undefined, existing]) {
          const before = await state();
          const response = await send(business, member, f.managerCookie, effect, revokeId);
          expect(response.status).toBe(403);
          expect(response.body['code']).toBe('PERMISSION_OWNER_ONLY');
          expect(await state()).toEqual(before);
        }
      }
    }
  }
});

it('device SAVE ALLOW fails; privileged role and override ALLOW are inert while DENY survives', async () => {
  const member = await target('device');
  for (const business of [false, true]) {
    const before = await state();
    expect((await send(business, member, f.cookie, 'ALLOW')).status).toBe(403);
    expect(await state()).toEqual(before);
    const denied = await send(business, member, f.cookie, 'DENY');
    expect(denied.status).toBe(201);
    expect(
      (await send(business, member, f.cookie, 'DENY', denied.body['id'] as string)).status,
    ).toBe(200);
  }
  await f.h.owner`UPDATE memberships SET role_id=${role('device')},role_owner_key='global'
    WHERE company_id=${f.company} AND id=${f.managerMember}`;
  await f.h
    .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND membership_id=${f.managerMember}`;
  await f.h.owner`INSERT INTO role_permissions(role_id,role_owner_key,permission_code)
    VALUES (${role('device')},'global',${code})`;
  await seedOverride(f, f.managerMember, { permission_code: code });
  expect(await authorize()).toBeNull();
  await seedOverride(f, f.managerMember, { permission_code: code, effect: 'DENY' });
  const access = await f.db.withTenant(f.company, async (tx) => {
    const { readAccessTransaction } = await import('../persistence/access-reader.ts');
    return readAccessTransaction(tx, f.company, f.managerId);
  });
  expect(access.grants.filter((g) => g.permission === code).map((g) => g.effect)).toEqual(['DENY']);
});
