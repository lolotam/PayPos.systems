import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  attendanceChangeFixture,
  changeInput,
  type ChangeFixture,
} from './attendance-change.fixture.ts';
import { leaveIds } from './leave.fixture.ts';
import { attendanceChangeProviders } from '../attendance-change.providers.ts';
import {
  ATTENDANCE_CHANGE_KINDS,
  type AttendanceChangeKinds,
} from '../ports/attendance-change-kinds.port.ts';
let f: ChangeFixture;
beforeAll(async () => {
  f = await attendanceChangeFixture(true);
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
it('ACR-12 production wiring registers ADD_SESSION, VOID_SESSION and RESTORE_SESSION', () => {
  const provider = attendanceChangeProviders(f.db, leaveIds).find(
    (entry) =>
      typeof entry === 'object' && 'provide' in entry && entry.provide === ATTENDANCE_CHANGE_KINDS,
  );
  const kinds =
    provider && typeof provider === 'object' && 'useValue' in provider
      ? (provider.useValue as AttendanceChangeKinds)
      : null;
  for (const kind of ['ADD_SESSION', 'VOID_SESSION', 'RESTORE_SESSION'] as const)
    expect(kinds?.find(kind)?.code).toBe(kind);
});

it('registers ADD_SESSION with the required manual values', async () => {
  const response = await f.h.app.inject({
    method: 'POST',
    url: `/v1/businesses/${f.business}/attendance-change-requests`,
    headers: {
      cookie: f.approverCookie,
      'x-company-id': f.company,
      'idempotency-key': leaveIds.newId(),
    },
    payload: changeInput(f),
  });
  expect(response.statusCode).toBe(201);
  expect(response.json().status).toBe('PENDING');
});
