import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { clockChallenge, clockAttendanceResult } from '@pospay/contracts';
import { attendanceFixture, type AttendanceFixture } from './clock-attendance.fixture.ts';
import { personalOrigin } from '../../../../test/personal-staff.fixture.ts';
let f: AttendanceFixture;
beforeAll(async () => {
  f = await attendanceFixture();
});
afterAll(async () => {
  await f?.close();
});
const url = '/v1/staff/attendance';
it('personal camera scan challenge + real UV assertion returns 200 and replays the accepted response', async () => {
  const scan = f.scan();
  const generated = await f.app.inject({
    method: 'POST',
    url: `${url}/challenge`,
    headers: f.headers,
    payload: scan,
  });
  expect(generated.statusCode).toBe(200);
  const challenge = clockChallenge.parse(generated.json());
  expect(challenge.options.userVerification).toBe('required');
  const payload = {
    ...scan,
    challenge_id: challenge.challenge_id,
    response: f.device.assertion(challenge.options.challenge, personalOrigin, 'localhost'),
  };
  const headers = {
    ...f.headers,
    'idempotency-key': f.ids.newId(),
    'x-company-id': f.otherCompany,
  };
  const send = () => f.app.inject({ method: 'POST', url: `${url}/clock`, headers, payload });
  const response = await send();
  expect(response.statusCode).toBe(200);
  expect(clockAttendanceResult.parse(response.json())).toMatchObject({
    operation: 'CLOCK_IN',
    exceptions: ['NONE'],
  });
  expect(response.headers['cache-control']).toBe('no-store');
  expect((await send()).json()).toEqual(response.json());
  const changed = await f.app.inject({
    method: 'POST',
    url: `${url}/clock`,
    headers,
    payload: { ...payload, location: { lat: 0, lng: 0, accuracy: 0 } },
  });
  expect(changed.statusCode).toBe(422);
});
it('rejects extra employee selectors, missing Idempotency-Key and inaccessible branches', async () => {
  expect(
    (
      await f.app.inject({
        method: 'POST',
        url: `${url}/challenge`,
        headers: f.headers,
        payload: { ...f.scan(), employee_id: f.employeeId },
      })
    ).statusCode,
  ).toBe(400);
  const other = await f.app.inject({
    method: 'POST',
    url: `${url}/challenge`,
    headers: f.headers,
    payload: f.scan(f.ids.newId()),
  });
  expect(other.statusCode).toBe(404);
  expect(other.json().code).toBe('NOT_FOUND');
  const generated = await f.app.inject({
    method: 'POST',
    url: `${url}/challenge`,
    headers: f.headers,
    payload: f.scan(),
  });
  const payload = {
    ...f.scan(),
    challenge_id: generated.json().challenge_id,
    response: f.device.assertion(generated.json().options.challenge, personalOrigin, 'localhost'),
  };
  expect(
    (
      await f.app.inject({ method: 'POST', url: `${url}/clock`, headers: f.headers, payload })
    ).json().code,
  ).toBe('IDEMPOTENCY_KEY_REQUIRED');
});
it('an admin, kiosk or device session cannot use personal clock routes', async () => {
  const kiosk = await f.auth.staff.issue(
    f.userId,
    {
      companyId: f.companyId,
      businessId: f.businessId,
      branchId: f.branchId,
      deviceId: f.ids.newId(),
    },
    async () => true,
  );
  for (const cookie of [
    '',
    kiosk.cookie.split(';')[0],
    f.headers.cookie.replace('pospay-personal.session_token', 'pospay.session_token'),
  ]) {
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: `${url}/challenge`,
          headers: { cookie: cookie ?? '', origin: personalOrigin },
          payload: f.scan(),
        })
      ).statusCode,
    ).toBe(401);
  }
  expect(
    (
      await f.app.inject({
        method: 'POST',
        url: `${url}/challenge`,
        headers: { ...f.headers, authorization: 'Device synthetic' },
        payload: f.scan(),
      })
    ).statusCode,
  ).toBe(401);
});
it('an unavailable QR secret store is NOT_READY (503) on both routes, like the PR 19 QR route', async () => {
  f.setNow(new Date());
  const scan = f.scan();
  const generated = await f.app.inject({
    method: 'POST',
    url: `${url}/challenge`,
    headers: f.headers,
    payload: scan,
  });
  const challenge = clockChallenge.parse(generated.json());
  const down = vi.spyOn(f.redis, 'get').mockRejectedValue(new Error('SYNTHETIC_REDIS_DOWN'));
  try {
    const refused = await f.app.inject({
      method: 'POST',
      url: `${url}/challenge`,
      headers: f.headers,
      payload: scan,
    });
    const clock = await f.app.inject({
      method: 'POST',
      url: `${url}/clock`,
      headers: { ...f.headers, 'idempotency-key': f.ids.newId() },
      payload: {
        ...scan,
        challenge_id: challenge.challenge_id,
        response: f.device.assertion(challenge.options.challenge, personalOrigin, 'localhost'),
      },
    });
    for (const response of [refused, clock]) {
      expect(response.statusCode).toBe(503);
      expect(response.json().code).toBe('NOT_READY');
    }
  } finally {
    down.mockRestore();
  }
});
