import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  addEmployee,
  grant,
  nextPhone,
  staffAccessFixture,
  type Fixture,
} from '../../../../test/staff-access.fixture.ts';
import { startHarness, type Harness } from '../../../../test/harness.ts';
import { paired, origin } from '../../../../test/staff-otp-harness.ts';

// الرقم السري المؤقت (076 F2): الموظفة اللي عندها سجل «إعطاء الدخول» ما بتدخلش برقم المدير؛
// لازم تغيّره الأول بدليل واحد، وبعدها الرقم الجديد دائم ويدخل عادي.
const TEMPORARY_PIN = '1234';
const NEW_PIN = '5678';
const OTHER_PIN = '6789';

let f: Fixture;
let device: Awaited<ReturnType<typeof paired>>;
let employeeNumber = 300;

beforeAll(async () => {
  f = await staffAccessFixture({ staffAccessRoutes: true, staffOrigin: origin });
  device = await paired(f.h, f.ownerCookie, f.company, f.salmiya);
});

afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

/** موظفة جديدة عندها سجل «إعطاء دخول» ورقم مؤقت بتحديده ('1234'). */
async function staffWithTemporaryPin(): Promise<{ phone: string; userId: string }> {
  employeeNumber += 1;
  const employee = await addEmployee(f, `Change ${employeeNumber}`, f.salmiya, employeeNumber);
  const phone = nextPhone(f);
  expect((await grant(f, employee, phone, f.ownerCookie)).status).toBe(200);
  const [record] = await f.h.owner`SELECT user_id FROM employee_staff_access
    WHERE employee_id=${employee}`;
  return { phone, userId: record?.user_id as string };
}

const signIn = (pin: string, phone: string) =>
  f.h.app.inject({
    method: 'POST',
    url: '/v1/devices/me/staff-pin/sign-in',
    headers: { authorization: `Device ${device.token}`, origin },
    payload: { phone, pin },
  });

const change = (proof: string, pin: string) =>
  f.h.app.inject({
    method: 'POST',
    url: '/v1/devices/me/staff-pin/change',
    headers: { authorization: `Device ${device.token}`, origin },
    payload: { proof, pin },
  });

const proofOf = (response: { json(): unknown }): string =>
  (response.json() as { details?: { proof?: string } }).details?.proof ?? '';

it('a temporary PIN answers 403 PIN_CHANGE_REQUIRED with a proof and issues no session', async () => {
  const { phone, userId } = await staffWithTemporaryPin();
  const wrong = await signIn('4321', phone);
  expect(wrong.statusCode).toBe(401);
  expect(wrong.json().code).toBe('PIN_INVALID');
  const temporary = await signIn(TEMPORARY_PIN, phone);
  expect(temporary.statusCode).toBe(403);
  expect(temporary.json().code).toBe('PIN_CHANGE_REQUIRED');
  expect(proofOf(temporary).length).toBeGreaterThanOrEqual(16);
  expect(await f.h.owner`SELECT id FROM session WHERE user_id=${userId}`).toHaveLength(0);
});

it('the proof changes the PIN once; a replay is refused and the new PIN signs in', async () => {
  const { phone, userId } = await staffWithTemporaryPin();
  const proof = proofOf(await signIn(TEMPORARY_PIN, phone));
  expect((await change(proof, NEW_PIN)).statusCode).toBe(204);
  const replay = await change(proof, NEW_PIN);
  expect(replay.statusCode).toBe(401);
  expect(replay.json().code).toBe('PIN_INVALID');
  const signedIn = await signIn(NEW_PIN, phone);
  expect(signedIn.statusCode).toBe(200);
  expect(signedIn.json().user_id).toBe(userId);
});

it('the temporary PIN in use cannot be chosen again', async () => {
  const { phone } = await staffWithTemporaryPin();
  const proof = proofOf(await signIn(TEMPORARY_PIN, phone));
  const same = await change(proof, TEMPORARY_PIN);
  expect(same.statusCode).toBe(401);
  expect(same.json().code).toBe('PIN_INVALID');
  // الرقم لسه مؤقت: الدخول بيه لسه بيطلب تغيير.
  expect((await signIn(TEMPORARY_PIN, phone)).statusCode).toBe(403);
});

it('two concurrent changes leave exactly one winner', async () => {
  const { phone } = await staffWithTemporaryPin();
  const proof = proofOf(await signIn(TEMPORARY_PIN, phone));
  const results = await Promise.allSettled([change(proof, NEW_PIN), change(proof, OTHER_PIN)]);
  const statuses = results.map((result) =>
    result.status === 'fulfilled' ? result.value.statusCode : 0,
  );
  expect(statuses.filter((status) => status === 204)).toHaveLength(1);
  expect(statuses.filter((status) => status === 401)).toHaveLength(1);
});

it('a manager reset after the proof was issued invalidates the proof', async () => {
  const { phone, userId } = await staffWithTemporaryPin();
  const proof = proofOf(await signIn(TEMPORARY_PIN, phone));
  const reset = await f.h.send('POST', '/v1/staff-pins/reset', {
    cookie: f.ownerCookie,
    company: f.company,
    body: { user_id: userId, pin: '4321' },
  });
  expect(reset.status).toBe(204);
  const refused = await change(proof, NEW_PIN);
  expect(refused.statusCode).toBe(401);
  expect(refused.json().code).toBe('PIN_INVALID');
});

it('five refused changes lock the user, and the locked change is refused', async () => {
  const { phone } = await staffWithTemporaryPin();
  const proof = proofOf(await signIn(TEMPORARY_PIN, phone));
  // إعادة اختيار الرقم المؤقت الحالي مرفوضة، فكل محاولة بتعدّ غلطة على صاحب الرقم.
  for (let attempt = 0; attempt < 5; attempt += 1)
    expect((await change(proof, TEMPORARY_PIN)).statusCode).toBe(401);
  const locked = await change(proof, NEW_PIN);
  expect(locked.statusCode).toBe(423);
  expect(locked.json().code).toBe('PIN_LOCKED');
});

describe('a temporary PIN past its twenty-four hours', () => {
  // ساعة الاختبار بتتحرك مع الوقت الحقيقي وبتزيح بعدين؛ ساعة الاعتماد نفسها بتفضل سليمة.
  let offset = 0;
  let expired: Fixture;
  let expiredDevice: Awaited<ReturnType<typeof paired>>;
  let phone: string;

  beforeAll(async () => {
    expired = await staffAccessFixture({
      staffAccessRoutes: true,
      staffOrigin: origin,
      clock: { now: () => new Date(Date.now() + offset) },
    });
    employeeNumber += 1;
    const employee = await addEmployee(
      expired,
      `Expiry ${employeeNumber}`,
      expired.salmiya,
      employeeNumber,
    );
    phone = nextPhone(expired);
    expect((await grant(expired, employee, phone, expired.ownerCookie)).status).toBe(200);
    expiredDevice = await paired(expired.h, expired.ownerCookie, expired.company, expired.salmiya);
  });

  afterAll(async () => {
    await expired?.db.close();
    await expired?.h.close();
  });

  it('is expired, and only the correct PIN says so', async () => {
    const send = (pin: string) =>
      expired.h.app.inject({
        method: 'POST',
        url: '/v1/devices/me/staff-pin/sign-in',
        headers: { authorization: `Device ${expiredDevice.token}`, origin },
        payload: { phone, pin },
      });
    const wrong = await send('4321');
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().code).toBe('PIN_INVALID');
    // ربع يوم بعد ما اتضبط الرقم: خلصت مدة الـ24 ساعة.
    offset = 25 * 60 * 60 * 1000;
    const lapsed = await send(TEMPORARY_PIN);
    expect(lapsed.statusCode).toBe(403);
    expect(lapsed.json().code).toBe('PIN_EXPIRED');
  });
});

it('the change route answers 503 NOT_READY while the activation gate is off', async () => {
  const closed: Harness = await startHarness({ staffOrigin: origin });
  try {
    const response = await closed.app.inject({
      method: 'POST',
      url: '/v1/devices/me/staff-pin/change',
      headers: { authorization: 'Device synthetic-token', origin },
      payload: { proof: 'a'.repeat(43), pin: NEW_PIN },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('NOT_READY');
  } finally {
    await closed.close();
  }
});
