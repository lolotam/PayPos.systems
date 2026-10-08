import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { SYSTEM_ROLES } from '@pospay/db';
import { attendanceExceptionRecord } from '@pospay/contracts';
import { origin, paired } from '../../../../test/staff-otp-harness.ts';
import {
  asRole,
  attendanceExceptionFixture,
  decision,
  exceptionAudits,
  exceptionFact,
  openException,
  type AttendanceExceptionFixture,
} from './attendance-exception.fixture.ts';
import { leaveIds } from './leave.fixture.ts';

let f: AttendanceExceptionFixture;
let ownCookie: string;
let device: { id: string; token: string };
beforeAll(async () => {
  f = await attendanceExceptionFixture();
  device = await paired(f.h, f.cookie, f.company, f.branch);
  const staff = SYSTEM_ROLES.find((role) => role.code === 'staff');
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    VALUES(${f.company},${leaveIds.newId()},${f.userId},${staff?.id as string},'global','BRANCH',${f.branch},'2026-01-01')`;
  await f.h.owner`UPDATE "user" SET phone_number='+99900000019' WHERE id=${f.userId}`;
  await f.h.owner`UPDATE "user" SET phone_binding_approved_at='2026-01-01' WHERE id=${f.userId}`;
  if (!f.h.auth.staff) throw new Error('Missing staff sessions');
  ownCookie =
    (
      await f.h.auth.staff.issue(
        f.userId,
        { companyId: f.company, businessId: f.business, branchId: f.branch, deviceId: device.id },
        async () => true,
      )
    ).cookie.split(';')[0] ?? '';
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const route = (id: string, action = 'resolve', businessId = f.business) =>
  `/v1/businesses/${businessId}/attendance-exceptions/${id}/${action}`;
const headers = (cookie = f.approverCookie) => ({
  cookie,
  'x-company-id': f.company,
  'idempotency-key': leaveIds.newId(),
});

it('returns the contract, requires a key, and replays or refuses key reuse', async () => {
  await asRole(f, 'business_manager');
  const seeded = await openException(f, 'OUT_OF_RANGE');
  const key = leaveIds.newId();
  const send = (payload = decision(), idem = key) =>
    f.h.app.inject({
      method: 'POST',
      url: route(seeded.id),
      headers: { ...headers(), 'idempotency-key': idem },
      payload,
    });
  const first = await send();
  expect(first.statusCode).toBe(200);
  expect(attendanceExceptionRecord.parse(first.json())).toMatchObject({
    status: 'RESOLVED',
    reason: 'errand for the shop',
    revision: 1,
  });
  expect((await send()).json()).toEqual(first.json());
  const reused = await send(decision(1, 'another reason'));
  expect(reused.statusCode).toBe(422);
  expect(reused.json().code).toBe('IDEMPOTENCY_KEY_REUSED');
  const missing = await f.h.app.inject({
    method: 'POST',
    url: route(seeded.id, 'reopen'),
    headers: { cookie: f.approverCookie, 'x-company-id': f.company },
    payload: decision(1),
  });
  expect(missing.statusCode).toBe(400);
  expect(missing.json().code).toBe('IDEMPOTENCY_KEY_REQUIRED');
});

it('refuses empty, blank, over-long and negative reasons as validation failed', async () => {
  const seeded = await openException(f, 'NONE');
  for (const payload of [
    decision(0, ''),
    decision(0, '   '),
    decision(0, 'x'.repeat(501)),
    { revision: -1, reason: 'errand' },
  ]) {
    const result = await f.h.app.inject({
      method: 'POST',
      url: route(seeded.id),
      headers: headers(),
      payload,
    });
    expect(result.statusCode).toBe(400);
    expect(result.json().code).toBe('VALIDATION_FAILED');
  }
});

it('RAE-05 returns the bilingual self refusal', async () => {
  const seeded = await openException(f, 'NONE');
  const result = await f.h.app.inject({
    method: 'POST',
    url: route(seeded.id),
    headers: headers(f.cookie),
    payload: decision(),
  });
  expect(result.statusCode).toBe(403);
  expect(result.json()).toMatchObject({
    code: 'ATTENDANCE_EXCEPTION_SELF_FORBIDDEN',
    message_ar: expect.any(String),
    message_en: expect.any(String),
  });
});

it('RAE-06 other branch and an unknown id share one not-found envelope', async () => {
  await asRole(f, 'branch_manager');
  const seeded = await openException(f, 'NONE', f.secondBranch);
  const other = await f.h.app.inject({
    method: 'POST',
    url: route(seeded.id),
    headers: headers(),
    payload: decision(),
  });
  const unknown = await f.h.app.inject({
    method: 'POST',
    url: route(leaveIds.newId()),
    headers: headers(),
    payload: decision(),
  });
  expect(other.statusCode).toBe(404);
  expect(unknown.statusCode).toBe(404);
  expect(other.json()).toEqual(unknown.json());
  expect(other.json().code).toBe('NOT_FOUND');
  expect(await exceptionFact(f, seeded.id)).toMatchObject([{ status: 'OPEN', revision: 0 }]);
});

it.each([
  ['resolve', 'attendance_exceptions'],
  ['resolve', 'employees'],
  ['reopen', 'attendance_exceptions'],
  ['reopen', 'employees'],
])('RAE-06 %s returns NOT_FOUND within a second while %s is locked', async (action, table) => {
  await asRole(f, 'business_manager');
  const seeded = await openException(f, 'NONE', f.secondBranch);
  if (action === 'reopen') {
    const resolved = await f.h.app.inject({
      method: 'POST',
      url: route(seeded.id),
      headers: headers(),
      payload: decision(),
    });
    expect(resolved.statusCode).toBe(200);
  }
  await asRole(f, 'branch_manager');
  const before = await exceptionFact(f, seeded.id);
  const audits = await exceptionAudits(f, seeded.id);
  const request = {
    method: 'POST' as const,
    headers: headers(),
    payload: decision(action === 'reopen' ? 1 : 0),
  };
  const missing = await f.h.app.inject({ ...request, url: route(leaveIds.newId(), action) });
  expect(missing.statusCode).toBe(404);
  expect(missing.json().code).toBe('NOT_FOUND');
  const holder = await f.h.owner.reserve();
  let pending: Promise<void> | undefined;
  let response: { statusCode: number; json(): unknown } | undefined;
  try {
    await holder`BEGIN`;
    const id = table === 'employees' ? f.employee.id : seeded.id;
    const locked = await holder`SELECT id FROM ${holder(table)}
      WHERE company_id=${f.company} AND id=${id} FOR UPDATE`;
    expect(locked).toHaveLength(1);
    pending = f.h.app.inject({ ...request, url: route(seeded.id, action) }).then((result) => {
      response = result;
    });
    await vi.waitFor(() => expect(response).toBeDefined(), { timeout: 1000, interval: 10 });
    expect(response?.statusCode).toBe(404);
    expect(response?.json()).toEqual(missing.json());
  } finally {
    await holder`ROLLBACK`;
    holder.release();
    await pending;
    await asRole(f, 'business_manager');
  }
  expect(await exceptionFact(f, seeded.id)).toEqual(before);
  expect(await exceptionAudits(f, seeded.id)).toEqual(audits);
  expect(
    await f.h.owner`SELECT key FROM idempotency_keys WHERE key=${request.headers['idempotency-key']}`,
  ).toHaveLength(0);
});

it('RAE-07 refuses the paired device', async () => {
  const seeded = await openException(f, 'OUT_OF_RANGE');
  const result = await f.h.app.inject({
    method: 'POST',
    url: route(seeded.id),
    headers: {
      cookie: ownCookie,
      authorization: `Device ${device.token}`,
      origin,
      'x-company-id': f.company,
      'idempotency-key': leaveIds.newId(),
    },
    payload: decision(),
  });
  expect(result.statusCode).toBe(403);
  expect(result.json().code).toBe('FORBIDDEN');
  expect(await exceptionFact(f, seeded.id)).toMatchObject([{ status: 'OPEN', revision: 0 }]);
});

it('hides another company and another business on both routes', async () => {
  await asRole(f, 'business_manager');
  const seeded = await openException(f, 'NONE');
  for (const action of ['resolve', 'reopen']) {
    const otherCompany = await f.h.app.inject({
      method: 'POST',
      url: route(seeded.id, action),
      headers: { ...headers(f.cookie), 'x-company-id': f.otherCompany },
      payload: decision(),
    });
    const otherBusiness = await f.h.app.inject({
      method: 'POST',
      url: route(seeded.id, action, f.secondBusiness),
      headers: headers(),
      payload: decision(),
    });
    expect(otherCompany.statusCode).toBe(404);
    expect(otherBusiness.statusCode).toBe(404);
    expect(otherCompany.json().code).toBe('NOT_FOUND');
    expect(otherBusiness.json().code).toBe('NOT_FOUND');
  }
  expect(await exceptionFact(f, seeded.id)).toMatchObject([{ status: 'OPEN', revision: 0 }]);
});
