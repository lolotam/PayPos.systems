import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  clockChallenge,
  type ClockAttendanceInput,
  type ClockAttendanceResult,
} from '@pospay/contracts';
import { personalOrigin } from '../../../../test/personal-staff.fixture.ts';
import { installationHash } from '../persistence/attendance-device-signal.ts';
import {
  attendanceFixture,
  SYNTHETIC_INSTALLATION,
  type AttendanceFixture,
} from './clock-attendance.fixture.ts';

const OTHER_INSTALLATION = '87654321-4321-4321-8321-cba987654321';
let f: AttendanceFixture;
let payload: ClockAttendanceInput;
let headers: Record<string, string>;
let accepted: ClockAttendanceResult;
const url = '/v1/staff/attendance/clock';
beforeAll(async () => {
  f = await attendanceFixture();
  const scan = f.scan();
  const generated = await f.app.inject({
    method: 'POST',
    url: '/v1/staff/attendance/challenge',
    headers: f.headers,
    payload: scan,
  });
  expect(generated.statusCode).toBe(200);
  const challenge = clockChallenge.parse(generated.json());
  payload = {
    ...scan,
    installation_id: SYNTHETIC_INSTALLATION,
    challenge_id: challenge.challenge_id,
    response: {
      ...f.device.assertion(challenge.options.challenge, personalOrigin, 'localhost'),
      clientExtensionResults: {},
    },
  };
  headers = { ...f.headers, 'idempotency-key': f.ids.newId() };
  const first = await f.app.inject({ method: 'POST', url, headers, payload });
  expect(first.statusCode).toBe(200);
  accepted = first.json();
});
afterAll(async () => {
  await f?.close();
});

it.each([
  ['a different installation', OTHER_INSTALLATION],
  ['different UUID casing', SYNTHETIC_INSTALLATION.toUpperCase()],
])(
  'the same accepted key/challenge/assertion replays with %s and keeps the first observation',
  async (_label, installationId) => {
    const retry = await f.app.inject({
      method: 'POST',
      url,
      headers,
      payload: { ...payload, installation_id: installationId },
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual(accepted);
    const rows = await f.owner`SELECT s.installation_hash,a.entity_id,a.action
    FROM attendance_device_signals s
    LEFT JOIN audit_log a ON a.company_id=s.company_id AND a.id=s.clock_event_id
    WHERE s.company_id=${f.companyId}`;
    expect(rows).toEqual([
      {
        installation_hash: installationHash(f.companyId, SYNTHETIC_INSTALLATION),
        entity_id: accepted.session_id,
        action: 'clocked_in',
      },
    ]);
    if (installationId === OTHER_INSTALLATION)
      expect(rows[0]?.['installation_hash']).not.toBe(
        installationHash(f.companyId, installationId),
      );
  },
);
