import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SYSTEM_ROLES } from '@pospay/db';
import { ids, must, type SessionFixture } from './session.fixture.ts';
import { customerPackagesFixture } from './customer-packages.fixture.ts';

let fixture: Awaited<ReturnType<typeof customerPackagesFixture>>;
let f: SessionFixture;
let deviceToken: string;

async function approvedDeviceToken(fixtureF: SessionFixture): Promise<string> {
  const pairing = await fixtureF.h.send('POST', `/v1/branches/${fixtureF.branch}/devices/pairing-code`, {
    cookie: fixtureF.ownerCookie,
    company: fixtureF.company,
  });
  expect(pairing.status).toBe(201);

  const registered = await fixtureF.h.app.inject({
    method: 'POST',
    url: '/v1/devices/register',
    payload: { pairing_code: pairing.body['code'], label: 'Synthetic package test till' },
  });
  expect(registered.statusCode).toBe(201);
  const regJson = registered.json() as { device_id: string; claim_secret: string };

  const approved = await fixtureF.h.send('POST', `/v1/branches/${fixtureF.branch}/devices/${regJson.device_id}/approve`, {
    cookie: fixtureF.ownerCookie,
    company: fixtureF.company,
  });
  expect(approved.status).toBe(204);

  const claimed = await fixtureF.h.app.inject({
    method: 'POST',
    url: '/v1/devices/claim',
    payload: {
      company_id: fixtureF.company,
      device_id: regJson.device_id,
      claim_secret: regJson.claim_secret,
    },
  });
  expect(claimed.statusCode).toBe(200);
  const claimJson = claimed.json() as { device_token: string };
  return must(claimJson.device_token);
}

beforeAll(async () => {
  fixture = await customerPackagesFixture();
  f = fixture.f;
  deviceToken = await approvedDeviceToken(f);
});

afterAll(async () => {
  await f?.close();
});

async function role(code: string, scope = 'BRANCH', scopeId = f.branch) {
  await f.h.owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND membership_id=${f.membership}`;
  await f.h.owner`UPDATE memberships SET role_id=${must(SYSTEM_ROLES.find((r) => r.code === code)).id},scope_type=${scope},scope_id=${scopeId},ends_at=NULL
    WHERE company_id=${f.company} AND id=${f.membership}`;
}

async function override(
  effect: 'ALLOW' | 'DENY',
  permissionCode = 'read:service-sessions:branch',
  branchId = f.branch,
  expires: string | null = null,
) {
  await f.h.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,expires_at,reason,granted_by)
    VALUES(${f.company},${ids.newId()},${f.membership},${permissionCode},${effect},'BRANCH',${branchId},${expires},'Synthetic access test',${f.ownerId})`;
}

const routes = [
  {
    name: 'list',
    path: (b = f.business, br = f.branch, c = f.customer) =>
      `/v1/businesses/${b}/branches/${br}/customers/${c}/packages`,
  },
  {
    name: 'detail',
    path: (b = f.business, br = f.branch, c = f.customer) =>
      `/v1/businesses/${b}/branches/${br}/customers/${c}/packages/${fixture.packages.a}`,
  },
];

describe.each(routes)('$name route permission matrix', ({ path }) => {
  const get = (url = path(), cookie = f.cookie, company = f.company) =>
    f.h.send('GET', url, { cookie, company });

  it('permits record-only and read-only, refusing when neither permission exists', async () => {
    await role('staff');
    expect((await get()).status).toBe(403);

    await override('ALLOW', 'record:service-sessions:branch');
    expect((await get()).status).toBe(200);

    await role('staff');
    await override('ALLOW', 'read:service-sessions:branch');
    expect((await get()).status).toBe(200);
  });

  it('allows access when one permission is DENY but the other is ALLOW, and refuses when both are DENY', async () => {
    await role('staff');
    await override('DENY', 'record:service-sessions:branch');
    await override('ALLOW', 'read:service-sessions:branch');
    expect((await get()).status).toBe(200);

    await role('staff');
    await override('DENY', 'record:service-sessions:branch');
    await override('DENY', 'read:service-sessions:branch');
    expect((await get()).status).toBe(403);
  });

  it('refuses when permission grant is scoped to another branch', async () => {
    await role('staff');
    await override('ALLOW', 'read:service-sessions:branch', f.secondBranch);
    expect((await get()).status).toBe(403);
  });
});

describe.each(routes)('$name route context refusals', ({ path }) => {
  const get = (url = path(), cookie = f.cookie, company = f.company) =>
    f.h.send('GET', url, { cookie, company });

  it('refuses device sessions with 403 FORBIDDEN', async () => {
    const res = await f.h.app.inject({
      method: 'GET',
      url: path(),
      headers: {
        authorization: `Device ${deviceToken}`,
        'x-company-id': f.company,
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
  });

  it('refuses with FEATURE_DISABLED when orders feature flag is turned off', async () => {
    await role('cashier');
    await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
      VALUES(${f.company},'orders',false,'Synthetic feature disable test',${f.ownerId})`;
    try {
      const disabled = await get();
      expect(disabled.status).toBe(403);
      expect(disabled.body['code']).toBe('FEATURE_DISABLED');
    } finally {
      await f.h.owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='orders'`;
    }
    expect((await get()).status).toBe(200);
  });

  it('refuses access when membership has ended', async () => {
    await role('cashier');
    await f.h.owner`UPDATE memberships SET ends_at=now() WHERE company_id=${f.company} AND id=${f.membership}`;
    try {
      expect((await get()).status).toBe(403);
    } finally {
      await f.h.owner`UPDATE memberships SET ends_at=NULL WHERE company_id=${f.company} AND id=${f.membership}`;
    }
    expect((await get()).status).toBe(200);
  });

  it('refuses access when branch is inactive, foreign or unknown', async () => {
    await role('cashier');
    await f.h.owner`UPDATE branches SET is_active=false WHERE company_id=${f.company} AND id=${f.branch}`;
    try {
      expect((await get()).status).toBe(403);
    } finally {
      await f.h.owner`UPDATE branches SET is_active=true WHERE company_id=${f.company} AND id=${f.branch}`;
    }

    expect((await get(path(f.business, f.secondBranch))).status).toBe(403);
    expect((await get(path(f.business, ids.newId()))).status).toBe(403);
  });
});
