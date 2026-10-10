import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  attendanceChangeFixture,
  changeInput,
  type ChangeFixture,
} from './attendance-change.fixture.ts';
import { leaveIds } from './leave.fixture.ts';
let f: ChangeFixture;
beforeAll(async () => {
  f = await attendanceChangeFixture(true);
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
it('ACR-12 production wiring refuses VOID_SESSION before storing requests, keys, audit or events', async () => {
  for (const kind of ['VOID_SESSION']) {
    const key = leaveIds.newId();
    const response = await f.h.app.inject({
      method: 'POST',
      url: `/v1/businesses/${f.business}/attendance-change-requests`,
      headers: { cookie: f.approverCookie, 'x-company-id': f.company, 'idempotency-key': key },
      payload: { employee_id: f.employee.id, reason: 'void attendance', kind },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('ATTENDANCE_CHANGE_KIND_UNAVAILABLE');
    expect(await f.h.owner`SELECT key FROM idempotency_keys WHERE key=${key}`).toHaveLength(0);
  }
  expect(await f.h.owner`SELECT id FROM attendance_change_requests`).toHaveLength(0);
  expect(
    await f.h.owner`SELECT id FROM audit_log WHERE entity='attendance_change_request'`,
  ).toHaveLength(0);
  expect(
    await f.h
      .owner`SELECT id FROM outbox WHERE event_type IN ('AttendanceChangeRequested','AttendanceChangeDecided')`,
  ).toHaveLength(0);
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
