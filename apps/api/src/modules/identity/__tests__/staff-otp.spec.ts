import { present } from '../../../../../../packages/db/test/present.ts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase } from '@pospay/db';
import { createStaffEligibility } from '../persistence/staff-eligibility.ts';
import {
  identity,
  origin,
  paired,
  phone,
  staffHarness,
} from '../../../../test/staff-otp-harness.ts';

let f: Awaited<ReturnType<typeof staffHarness>>,
  company: string,
  business: string,
  branch: string,
  userId: string,
  member: string;
let device: Awaited<ReturnType<typeof paired>>;
const request = (phoneNumber = phone, headers: Record<string, string> = {}) =>
  f.h.app.inject({
    method: 'POST',
    url: '/v1/devices/me/staff-otp/request',
    headers: { authorization: `Device ${device.token}`, origin, ...headers },
    payload: { phone: phoneNumber, locale: 'ar' },
  });
const verify = async (id: string, code: string) =>
  f.h.app.inject({
    method: 'POST',
    url: '/v1/devices/me/staff-otp/verify',
    headers: { authorization: `Device ${device.token}`, origin },
    payload: { challenge_id: id, code },
  });
const session = (cookie: string, headers: Record<string, string> = {}) =>
  f.h.app.inject({
    method: 'GET',
    url: '/v1/devices/me/staff-session',
    headers: { authorization: `Device ${device.token}`, cookie, origin, ...headers },
  });

beforeAll(async () => {
  f = await staffHarness();
  const cookie = await f.h.signedInOperator('synthetic-owner@otp.invalid');
  company = await f.h.onboard(cookie, 'OTP Co');
  business = (
    await f.h.send('POST', '/v1/businesses', {
      cookie,
      company,
      key: 'otp-business',
      body: { vertical_type: 'salon', name_en: 'Synthetic salon' },
    })
  ).body['id'] as string;
  branch = (
    await f.h.send('POST', `/v1/businesses/${business}/branches`, {
      cookie,
      company,
      key: 'otp-branch',
      body: { name_en: 'Synthetic branch' },
    })
  ).body['id'] as string;
  device = await paired(f.h, cookie, company, branch);
  userId = await f.h.auth.provisionUser({
    email: 'synthetic-staff@otp.invalid',
    name: 'Synthetic staff',
    password: 'synthetic'.repeat(8),
  });
  member = randomUUID();
  await f.h.owner`UPDATE "user" SET phone_number=${phone} WHERE id=${userId}`;
  await f.h.owner`UPDATE "user" SET phone_binding_approved_at=clock_timestamp() WHERE id=${userId}`;
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,scope_type,scope_id,role_id,role_owner_key,starts_at)
    SELECT ${company},${member},${userId},'BRANCH',${branch},id,'global',now()-interval '1 day' FROM roles WHERE code='staff' AND company_id IS NULL`;
});
afterAll(async () => {
  await f?.close();
});

it('refuses absent/malformed Device credentials, Origin/body abuse and forwarded IP spoofing', async () => {
  expect((await request(phone, { authorization: '' })).statusCode).toBe(401);
  expect((await request(phone, { authorization: 'Device malformed' })).statusCode).toBe(401);
  expect((await request(phone, { origin: 'https://other.synthetic.invalid' })).statusCode).toBe(
    403,
  );
  expect(
    (await request(phone, { 'x-company-id': randomUUID(), 'x-forwarded-for': '198.51.100.1' }))
      .statusCode,
  ).toBe(202);
  expect(f.h.calls.tenant.filter((x) => x !== company)).toEqual([]);
  await f.h.redis.del(
    `staff-otp:cooldown:${Buffer.from(identity.identify(phone).hash).toString('hex')}`,
  );
  const body = await f.h.app.inject({
    method: 'POST',
    url: '/v1/devices/me/staff-otp/request',
    headers: { authorization: `Device ${device.token}`, origin },
    payload: { phone, locale: 'ar', extra: 'x'.repeat(2000) },
  });
  expect(body.statusCode).toBe(413);
});
it('unknown and valid phones have the same 202 envelope, headers and common window; only valid receives a job', async () => {
  const outcomesBefore = f.outcomes.length;
  const eligible = await request();
  const duration = performance.now() - present(f.windowStarts.at(-1));
  const count = f.jobs.length,
    absent = await request('+99900000002');
  expect(eligible.statusCode).toBe(202);
  expect(f.outcomes.slice(outcomesBefore), f.failures.join(',')).not.toContain(
    'PREPARATION_FAILED',
  );
  expect(absent.statusCode).toBe(202);
  const a = eligible.json(),
    b = absent.json();
  expect({ ...a, challenge_id: '' }).toEqual({ ...b, challenge_id: '' });
  expect(a).toMatchObject({
    status: 'ACCEPTED',
    expires_in: 300,
    retry_after: 60,
    recovery: 'ASK_MANAGER',
  });
  expect(eligible.headers['retry-after']).toBeUndefined();
  expect(absent.headers['retry-after']).toBeUndefined();
  expect(duration).toBeGreaterThanOrEqual(190);
  expect(duration).toBeLessThan(350);
  expect(f.jobs).toHaveLength(count);
  expect(await f.db.find(b.challenge_id)).toBeNull();
  expect(f.jobs.at(-1)).toEqual({ challengeId: a.challenge_id, attemptId: expect.any(String) });
});
it('verifies into the isolated staff cookie, refuses replay/admin substitution, then revokes on membership change', async () => {
  await f.h.redis.del(
    `staff-otp:cooldown:${Buffer.from(identity.identify(phone).hash).toString('hex')}`,
  );
  const requested = await request();
  expect(requested.statusCode).toBe(202);
  const id = requested.json().challenge_id as string;
  expect(
    f.jobs.some((job) => job.challengeId === id),
    f.failures.join(','),
  ).toBe(true);
  const code = await f.code(id);
  const wrong = await verify(id, String(1).padStart(6, '0'));
  expect(wrong.statusCode).toBe(401);
  expect(wrong.json().code).toBe('OTP_INVALID');
  const success = await verify(id, code);
  expect((await f.db.find(id))?.status, JSON.stringify(success.json())).toBe('CONSUMED');
  expect(f.sessionFailures).toEqual([]);
  expect(success.statusCode).toBe(200);
  expect(success.json()).toMatchObject({
    user_id: userId,
    company_id: company,
    business_id: business,
    branch_id: branch,
    device_id: device.id,
  });
  const cookie = present(String(success.headers['set-cookie']).split(';')[0]);
  expect((await session(cookie)).statusCode).toBe(200);
  expect((await verify(id, code)).statusCode).toBe(401);
  expect(
    (await f.h.app.inject({ method: 'GET', url: '/v1/me/workspaces', headers: { cookie } }))
      .statusCode,
  ).toBe(401);
  const adminCookie = cookie.replace('pospay-staff.session_token', 'pospay.session_token');
  expect(
    (
      await f.h.app.inject({
        method: 'GET',
        url: '/v1/auth/get-session',
        headers: { cookie: adminCookie },
      })
    ).statusCode,
  ).toBe(403);
  await f.h
    .owner`UPDATE memberships SET ends_at=now() WHERE company_id=${company} AND id=${member}`;
  expect((await session(cookie)).statusCode).toBe(401);
  expect(f.h.calls.user).not.toContain(userId);
});

async function setMembership(scope: 'COMPANY' | 'BUSINESS' | 'BRANCH', id: string, role = 'staff') {
  await f.h
    .owner`UPDATE memberships SET scope_type=${scope},scope_id=${id},starts_at=now()-interval '1 day',ends_at=NULL,
    role_id=(SELECT id FROM roles WHERE code=${role} AND company_id IS NULL)
    WHERE company_id=${company} AND id=${member}`;
}
it('a reception role needs an explicit login grant, while administrative roles have no implicit login', async () => {
  const db = createDatabase({ url: f.h.urls.app, ids: { newId: randomUUID } });
  const reader = createStaffEligibility(db),
    role = randomUUID(),
    grant = randomUUID();
  const context = {
    companyId: company,
    businessId: business,
    branchId: branch,
    deviceId: device.id,
  };
  try {
    await f.h
      .owner`INSERT INTO roles(id,company_id,code,name_en) VALUES(${role},${company},'synthetic_reception','Synthetic reception')`;
    await f.h
      .owner`UPDATE memberships SET role_id=${role},role_owner_key=${company},ends_at=NULL WHERE company_id=${company} AND id=${member}`;
    expect(await reader.eligible(userId, context)).toBe(false);
    await f.h
      .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
      VALUES(${company},${grant},${member},'login:staff:branch','ALLOW','BRANCH',${branch},'synthetic grant',${userId})`;
    expect(await reader.eligible(userId, context)).toBe(true);
    await f.h.owner`DELETE FROM permission_overrides WHERE company_id=${company} AND id=${grant}`;
    for (const administrative of [
      'owner',
      'general_manager',
      'business_manager',
      'branch_manager',
    ]) {
      await f.h
        .owner`UPDATE memberships SET role_id=(SELECT id FROM roles WHERE code=${administrative} AND company_id IS NULL),role_owner_key='global'
        WHERE company_id=${company} AND id=${member}`;
      expect(await reader.eligible(userId, context)).toBe(false);
    }
  } finally {
    await f.h
      .owner`UPDATE memberships SET role_id=(SELECT id FROM roles WHERE code='staff' AND company_id IS NULL),role_owner_key='global' WHERE company_id=${company} AND id=${member}`;
    await db.close();
  }
});

it('reads company/business/branch coverage and active windows in only the proven device company', async () => {
  const db = createDatabase({ url: f.h.urls.app, ids: { newId: randomUUID } });
  const reader = createStaffEligibility(db),
    context = { companyId: company, businessId: business, branchId: branch, deviceId: device.id };
  try {
    for (const [scope, id] of [
      ['COMPANY', company],
      ['BUSINESS', business],
      ['BRANCH', branch],
    ] as const) {
      await setMembership(scope, id);
      expect(await reader.eligible(userId, context)).toBe(true);
    }
    await f.h
      .owner`UPDATE memberships SET starts_at=now()+interval '1 day' WHERE company_id=${company} AND id=${member}`;
    expect(await reader.eligible(userId, context)).toBe(false);
    await f.h
      .owner`UPDATE memberships SET starts_at=now()-interval '1 day',ends_at=now()-interval '1 hour' WHERE company_id=${company} AND id=${member}`;
    expect(await reader.eligible(userId, context)).toBe(false);
    await setMembership('BRANCH', branch);
    expect(await reader.eligible(userId, { ...context, companyId: randomUUID() })).toBe(false);
    expect(await reader.eligible(userId, { ...context, branchId: randomUUID() })).toBe(false);
  } finally {
    await db.close();
  }
});

it('cashier requires explicit permission, DENY wins and closing the company removes eligibility without changing request privacy', async () => {
  const db = createDatabase({ url: f.h.urls.app, ids: { newId: randomUUID } });
  const reader = createStaffEligibility(db),
    context = { companyId: company, businessId: business, branchId: branch, deviceId: device.id };
  const override = randomUUID();
  try {
    await setMembership('BRANCH', branch, 'cashier');
    expect(await reader.eligible(userId, context)).toBe(false);
    await f.h
      .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
      VALUES(${company},${override},${member},'login:staff:branch','ALLOW','BRANCH',${branch},'synthetic explicit grant',${userId})`;
    expect(await reader.eligible(userId, context)).toBe(true);
    await f.h
      .owner`UPDATE permission_overrides SET effect='DENY' WHERE company_id=${company} AND id=${override}`;
    expect(await reader.eligible(userId, context)).toBe(false);
    await f.h
      .owner`DELETE FROM permission_overrides WHERE company_id=${company} AND id=${override}`;
    await setMembership('BRANCH', branch, 'owner');
    expect(await reader.eligible(userId, context)).toBe(false);
    await setMembership('BRANCH', branch);
    await f.h.owner`UPDATE companies SET deleted_at=now() WHERE id=${company}`;
    expect(await reader.eligible(userId, context)).toBe(false);
    const hash = Buffer.from(identity.identify(phone).hash).toString('hex');
    await f.h.redis.del(`staff-otp:cooldown:${hash}`, `staff-otp:request:phone:${hash}`);
    const before = f.jobs.length,
      closed = await request();
    expect(closed.statusCode).toBe(202);
    expect(f.jobs).toHaveLength(before);
    expect(closed.json()).toMatchObject({ status: 'ACCEPTED', recovery: 'ASK_MANAGER' });
    expect(closed.headers['retry-after']).toBeUndefined();
  } finally {
    await f.h.owner`UPDATE companies SET deleted_at=NULL WHERE id=${company}`;
    await db.close();
  }
});
