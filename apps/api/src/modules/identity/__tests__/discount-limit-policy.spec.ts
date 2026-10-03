import { SYSTEM_ROLES } from '@pospay/db';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  newMember,
  newHeldMember,
  permissionFixture,
  seedOverride,
  type PermissionFixture,
} from './permissions-screen.fixture.ts';

let f: PermissionFixture;
beforeAll(async () => {
  f = await permissionFixture();
  await seedOverride(f, f.ownMember, { permission_code: 'manage:discounts:company' });
  await seedOverride(f, f.managerMember, { permission_code: 'manage:memberships:company' });
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const set = (member: string, cookie = f.cookie) =>
  f.h.send('POST', `/v1/permissions/memberships/${member}/discount-limit`, {
    cookie,
    company: f.company,
    body: { limit_bps: 500, reason: 'Synthetic policy' },
  });
async function scopedMember(scope_type: string, scope_id: string) {
  const member = await newMember(f);
  await f.h.owner`UPDATE memberships SET scope_type=${scope_type}, scope_id=${scope_id}
    WHERE company_id=${f.company} AND id=${member}`;
  return member;
}
async function endOverride(id: string) {
  await f.h
    .owner`UPDATE permission_overrides SET expires_at=now() WHERE company_id=${f.company} AND id=${id}`;
}

it('DL-06 missing and expired grants are refused; business authority covers its branches only', async () => {
  const branch = await scopedMember('BRANCH', f.branch);
  const outside = await scopedMember('BUSINESS', f.otherBusiness);
  expect((await set(branch, f.managerCookie)).body['code']).toBe('PERMISSION_NOT_HELD');
  const allow = await seedOverride(f, f.managerMember, {
    permission_code: 'manage:discounts:company',
    scope_type: 'BUSINESS',
    scope_id: f.business,
  });
  expect((await set(branch, f.managerCookie)).status).toBe(200);
  expect((await set(outside, f.managerCookie)).body['code']).toBe('PERMISSION_SCOPE_OUTSIDE_REACH');
  await endOverride(allow);
  expect((await set(branch, f.managerCookie)).body['code']).toBe('PERMISSION_NOT_HELD');
});

it('DL-06 a descendant DENY prevents company delegation; unrelated branch limits remain editable', async () => {
  const companyMember = await newMember(f);
  const sibling = await scopedMember('BRANCH', f.siblingBranch);
  const allow = await seedOverride(f, f.managerMember, {
    permission_code: 'manage:discounts:company',
  });
  const deny = await seedOverride(f, f.managerMember, {
    permission_code: 'manage:discounts:company',
    effect: 'DENY',
    scope_type: 'BRANCH',
    scope_id: f.branch,
  });
  expect((await set(companyMember, f.managerCookie)).body['code']).toBe('PERMISSION_NOT_HELD');
  expect((await set(sibling, f.managerCookie)).status).toBe(200);
  await endOverride(deny);
  await endOverride(allow);
});

it('DL-05 inactive owners and owners in another company do not protect this holder', async () => {
  const employeeId = f.ids.newId();
  const inactiveOwner = await newHeldMember(f, { employeeId }, 'owner');
  await f.h
    .owner`UPDATE memberships SET starts_at=now()-interval '2 days', ends_at=now()-interval '1 day'
    WHERE company_id=${f.company} AND id=${inactiveOwner}`;
  await newHeldMember(f, { employeeId }, 'owner', f.otherCompany);
  const viewer = await newHeldMember(f, { employeeId });
  expect((await set(viewer)).status).toBe(200);
});

function barrier() {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

it.each(['owner', 'viewer'])(
  'DL-09 observes concurrent audited sibling role change to %s without deadlock',
  async (roleCode) => {
    const member = await newHeldMember(f, { userId: f.managerId });
    const role = SYSTEM_ROLES.find((r) => r.code === roleCode)?.id;
    if (role === undefined) throw new Error('Synthetic role missing');
    const locked = barrier(),
      release = barrier();
    const auditId = f.ids.newId();
    const promotion = f.h.owner.begin(async (tx) => {
      await tx`UPDATE memberships SET role_id=${role},role_owner_key='global' WHERE company_id=${f.company} AND id=${f.managerMember}`;
      locked.release();
      await release.promise;
      await tx`INSERT INTO audit_log (company_id,id,actor_user_id,entity,entity_id,action)
      VALUES (${f.company},${auditId},${f.userId},'membership',${f.managerMember},'role.changed')`;
    });
    await locked.promise;
    const request = set(member);
    const observer = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
    try {
      await vi.waitFor(
        async () => {
          const waiting =
            await observer`SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
        AND wait_event_type='Lock' AND query LIKE '%memberships%FOR UPDATE%'`;
          expect(waiting.length).toBeGreaterThan(0);
        },
        { timeout: 5000, interval: 20 },
      );
    } finally {
      release.release();
      try {
        await promotion;
      } finally {
        await observer.end();
      }
    }
    const result = await request;
    expect(result.status).toBe(roleCode === 'owner' ? 403 : 200);
    if (roleCode === 'owner') expect(result.body['code']).toBe('PERMISSION_OWNER_PROTECTED');
    const rows = await f.h
      .owner`SELECT id FROM audit_log WHERE company_id=${f.company} AND id=${auditId}`;
    expect(rows).toHaveLength(1);
  },
);
