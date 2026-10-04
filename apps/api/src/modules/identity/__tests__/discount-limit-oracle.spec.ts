import { SYSTEM_ROLES } from '@pospay/db';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  newHeldMember,
  newMember,
  permissionFixture,
  seedOverride,
  type PermissionFixture,
} from './permissions-screen.fixture.ts';

let f: PermissionFixture;
let deniedBusiness: string;
let deniedBranch: string;
let allowedBranch: string;
let otherBusiness: string;
let companyMember: string;
let foreignMember: string;
let endedMember: string;
let selfSibling: string;
let deny: string;
beforeAll(async () => {
  f = await permissionFixture();
  await actorRole('business_manager');
  deniedBusiness = await scopedMember('BUSINESS', f.business);
  deniedBranch = await scopedMember('BRANCH', f.branch);
  allowedBranch = await scopedMember('BRANCH', f.siblingBranch);
  otherBusiness = await scopedMember('BUSINESS', f.otherBusiness);
  companyMember = await newMember(f);
  foreignMember = await newMember(f, 'viewer', f.otherCompany);
  endedMember = await scopedMember('BUSINESS', f.business);
  await f.h.owner`UPDATE memberships SET ends_at=now()
    WHERE company_id=${f.company} AND id=${endedMember}`;
  selfSibling = await newHeldMember(f, { userId: f.managerId });
  await f.h.owner`UPDATE memberships SET scope_type='BUSINESS',scope_id=${f.business}
    WHERE company_id=${f.company} AND id=${selfSibling}`;
  deny = await seedOverride(f, f.managerMember, {
    permission_code: 'manage:discount-limits:business',
    effect: 'DENY',
    scope_type: 'BRANCH',
    scope_id: f.branch,
  });
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
async function actorRole(code: 'business_manager' | 'general_manager') {
  const role = SYSTEM_ROLES.find((r) => r.code === code)?.id ?? '';
  const scope = code === 'business_manager' ? 'BUSINESS' : 'COMPANY';
  await f.h.owner`UPDATE memberships SET role_id=${role},role_owner_key='global',
    scope_type=${scope},scope_id=${scope === 'BUSINESS' ? f.business : f.company}
    WHERE company_id=${f.company} AND id=${f.managerMember}`;
}
async function scopedMember(scope: string, id: string) {
  const member = await newMember(f);
  await f.h.owner`UPDATE memberships SET scope_type=${scope},scope_id=${id}
    WHERE company_id=${f.company} AND id=${member}`;
  return member;
}
const bodies = [
  { limit_bps: 1234, reason: 'Synthetic valid probe' },
  { limit_bps: 10001, reason: 'probe' },
];
const post = (member: string, body: object, cookie = f.managerCookie) =>
  f.h.send('POST', `/v1/permissions/memberships/${member}/discount-limit`, {
    cookie,
    company: f.company,
    body,
  });
const envelope = (r: { status: number; body: Record<string, unknown> }) => ({
  status: r.status,
  code: r.body['code'],
  body: r.body,
});

it.each(bodies)('BM hides every inaccessible target before validating $limit_bps', async (body) => {
  const unknown = envelope(await post(f.ids.newId(), body));
  expect(unknown).toMatchObject({ status: 403, code: 'FORBIDDEN' });
  for (const member of [
    deniedBusiness,
    deniedBranch,
    otherBusiness,
    companyMember,
    foreignMember,
    endedMember,
    f.managerMember,
    selfSibling,
    f.ownMember,
    'not-a-uuid',
  ])
    expect(envelope(await post(member, body))).toEqual(unknown);
  const sibling = await post(allowedBranch, body);
  expect(sibling.status).toBe(body.limit_bps > 10000 ? 400 : 200);
  if (body.limit_bps > 10000) expect(sibling.body['code']).toBe('VALIDATION_FAILED');
});

function barrier() {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

it('GM cannot expose company targets, self or protected owners behind a descendant DENY', async () => {
  await actorRole('general_manager');
  for (const body of bodies) {
    const unknown = envelope(await post(f.ids.newId(), body));
    expect(unknown).toMatchObject({ status: 403, code: 'FORBIDDEN' });
    for (const member of [companyMember, f.managerMember, selfSibling, f.ownMember])
      expect(envelope(await post(member, body))).toEqual(unknown);
  }
});

it('self and owner failures are named only for fully authorized targets; the mutation stays protected', async () => {
  await f.h.owner`UPDATE permission_overrides SET expires_at=now()
    WHERE company_id=${f.company} AND id=${deny}`;
  const valid = bodies[0] ?? {};
  const invalid = bodies[1] ?? {};
  for (const [member, code] of [
    [f.managerMember, 'PERMISSION_SELF_EDIT'],
    [selfSibling, 'PERMISSION_SELF_EDIT'],
    [f.ownMember, 'PERMISSION_OWNER_PROTECTED'],
  ] as const) {
    expect(envelope(await post(member, valid))).toMatchObject({ status: 403, code });
    expect(envelope(await post(member, invalid))).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
    });
  }
  expect((await post(deniedBusiness, valid)).status).toBe(200);
  expect(
    await f.h.owner`SELECT limit_bps FROM memberships WHERE company_id=${f.company}
      AND id IN (${f.managerMember},${selfSibling},${f.ownMember})`,
  ).toEqual([{ limit_bps: null }, { limit_bps: null }, { limit_bps: null }]);
});

it('locked recheck catches a descendant DENY committed after the HTTP preflight', async () => {
  const locked = barrier(),
    release = barrier();
  const override = f.ids.newId();
  const change = f.h.owner.begin(async (tx) => {
    await tx`SELECT id FROM companies WHERE id=${f.company} FOR NO KEY UPDATE`;
    locked.release();
    await release.promise;
    await tx`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,
      effect,scope_type,scope_id,reason,granted_by) VALUES (${f.company},${override},${f.managerMember},
      'manage:discount-limits:business','DENY','BRANCH',${f.branch},'Synthetic concurrent denial',${f.userId})`;
  });
  await locked.promise;
  const request = post(deniedBusiness, bodies[0] ?? {});
  const observer = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await vi.waitFor(
      async () => {
        const waiting =
          await observer`SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
          AND wait_event_type='Lock' AND query LIKE '%companies%FOR NO KEY UPDATE%'`;
        expect(waiting.length).toBeGreaterThan(0);
      },
      { timeout: 5000, interval: 20 },
    );
  } finally {
    release.release();
    try {
      await change;
    } finally {
      await observer.end();
    }
  }
  expect(envelope(await request)).toMatchObject({ status: 403, code: 'FORBIDDEN' });
  expect(
    await f.h.owner`SELECT limit_bps FROM memberships
    WHERE company_id=${f.company} AND id=${deniedBusiness}`,
  ).toEqual([{ limit_bps: 1234 }]);
});

it('a deleted company is refused like an unknown target before body validation', async () => {
  await f.h.owner`UPDATE companies SET deleted_at=now() WHERE id=${f.company}`;
  for (const body of bodies) {
    const unknown = envelope(await post(f.ids.newId(), body, f.cookie));
    expect(unknown).toMatchObject({ status: 403, code: 'FORBIDDEN' });
    for (const member of [deniedBusiness, companyMember, f.ownMember])
      expect(envelope(await post(member, body, f.cookie))).toEqual(unknown);
  }
});
