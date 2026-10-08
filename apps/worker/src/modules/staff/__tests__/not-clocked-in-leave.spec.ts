import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  ALERT_AT,
  notClockedInFixture,
  SHIFT_END,
  SHIFT_START,
  type NotClockedInFixture,
  type Tenant,
} from './not-clocked-in.fixture.ts';

let f: NotClockedInFixture;
beforeAll(async () => {
  f = await notClockedInFixture();
});
afterAll(async () => {
  await f?.close();
});

async function employee(tenant: Tenant, name: string) {
  const id = await f.employee(tenant, { nameEn: name });
  await f.shift(tenant, id);
  return id;
}

it('NCI-04 approved full-day leave suppresses the alert and pending leave does not', async () => {
  const tenant = await f.tenant();
  const excused = await employee(tenant, 'Excused');
  const pending = await employee(tenant, 'Pending');
  const span = {
    kind: 'FULL_DAY' as const,
    from: '2026-10-04',
    to: '2026-10-04',
    start: null,
    end: null,
    startsAt: new Date('2026-10-03T21:00:00.000Z'),
    endsAt: new Date('2026-10-04T21:00:00.000Z'),
  };
  await f.leave(tenant, excused, { ...span, status: 'APPROVED' });
  await f.leave(tenant, pending, { ...span, status: 'PENDING' });
  f.setNow(ALERT_AT);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  expect(await f.notices(tenant.company, excused)).toHaveLength(0);
  expect(await f.notices(tenant.company, pending)).toHaveLength(1);
  expect(span.endsAt.getTime()).toBeGreaterThan(SHIFT_END.getTime());
});

it('NCI-04 full-day leave excuses 22:00–06:00 even at 00:20 the next day', async () => {
  const tenant = await f.tenant();
  const employee = await f.employee(tenant);
  await f.shift(tenant, employee, {
    start: '22:00', end: '06:00',
    startsAt: new Date('2026-10-04T19:00:00Z'), endsAt: new Date('2026-10-05T03:00:00Z'),
  });
  await f.leave(tenant, employee, {
    kind: 'FULL_DAY', status: 'APPROVED', from: '2026-10-04', to: '2026-10-04',
    start: null, end: null,
    startsAt: new Date('2026-10-03T21:00:00Z'), endsAt: new Date('2026-10-04T21:00:00Z'),
  });
  for (const now of ['2026-10-04T19:20:00Z', '2026-10-04T21:20:00Z']) {
    f.setNow(new Date(now));
    expect(await f.detect().execute(tenant.company)).toEqual({ notified: 0 });
  }
  expect(await f.notices(tenant.company, employee)).toHaveLength(0);
  expect(await f.events(tenant.company)).toHaveLength(0);
});

it('NC-Q13 the OPEN first-shift session suppresses the second shift, but a closed one does not', async () => {
  const tenant = await f.tenant();
  const employee = await f.employee(tenant);
  await f.shift(tenant, employee, {
    start: '08:00', end: '12:00',
    startsAt: new Date('2026-10-04T05:00:00Z'), endsAt: new Date('2026-10-04T09:00:00Z'),
  });
  await f.shift(tenant, employee, {
    start: '12:30', end: '18:00', startsAt: new Date('2026-10-04T09:30:00Z'),
  });
  const session = await f.clockIn(tenant, employee, new Date('2026-10-04T04:55:00Z'));
  f.setNow(new Date('2026-10-04T09:50:00Z'));
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 0 });
  expect(await f.notices(tenant.company, employee)).toHaveLength(0);
  await f.owner`UPDATE attendance_sessions SET status='CLOSED', closed_by='EMPLOYEE', clock_out='2026-10-04T09:00:00Z'
    WHERE company_id=${tenant.company} AND id=${session}`;
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
});

it('NCI-05 approved partial leave covering the start defers the alert to 12:20', async () => {
  const tenant = await f.tenant();
  const id = await employee(tenant, 'Partial');
  await f.leave(tenant, id, {
    kind: 'PARTIAL',
    status: 'APPROVED',
    from: '2026-10-04',
    to: '2026-10-04',
    start: '10:00',
    end: '12:00',
    startsAt: SHIFT_START,
    endsAt: new Date('2026-10-04T09:00:00.000Z'),
  });
  f.setNow(ALERT_AT);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 0 });
  const deferred = new Date('2026-10-04T09:20:00.000Z');
  f.setNow(deferred);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  const [notice] = await f.notices(tenant.company, id);
  expect(new Date(notice?.['alert_due_at'] as string | Date).toISOString()).toBe(
    deferred.toISOString(),
  );
});

it.each(['CLOSED', 'MISSED_OUT'] as const)('NC-Q13 %s after alertAt before the run preserves presence', async (status) => {
  const tenant = await f.tenant();
  const id = await f.employee(tenant);
  await f.shift(tenant, id, {
    start: '12:30', end: '18:00', startsAt: new Date('2026-10-04T09:30:00Z'),
  });
  const clockIn = new Date(status === 'MISSED_OUT' ? '2026-10-03T17:55:00Z' : '2026-10-04T04:55:00Z');
  const session = await f.clockIn(tenant, id, clockIn);
  const closedBy = status === 'MISSED_OUT' ? 'MISSED_OUT' : 'EMPLOYEE';
  await f.owner`UPDATE attendance_sessions SET status=${status}, closed_by=${closedBy}, clock_out='2026-10-04T09:55:00Z'
    WHERE company_id=${tenant.company} AND id=${session}`;
  f.setNow(new Date('2026-10-04T10:00:00Z'));
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 0 });
  expect(await f.notices(tenant.company, id)).toHaveLength(0);
  expect(await f.events(tenant.company)).toHaveLength(0);
  await f.owner`UPDATE attendance_sessions SET clock_out='2026-10-04T09:50:00Z'
    WHERE company_id=${tenant.company} AND id=${session}`;
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
});

it.each(['APPROVED', 'PENDING'] as const)('BR-002 contiguous leave chains into %s FULL_DAY on D+1 across stored timezones', async (status) => {
  const tenant = await f.tenant();
  const id = await f.employee(tenant);
  const startsAt = new Date('2026-10-04T19:00:00Z');
  const midnight = new Date('2026-10-04T20:00:00Z');
  await f.shift(tenant, id, {
    start: '22:00', end: '06:00', startsAt, endsAt: new Date('2026-10-05T03:00:00Z'),
  });
  await f.leave(tenant, id, {
    kind: 'PARTIAL', status: 'APPROVED', from: '2026-10-04', to: '2026-10-04',
    start: '22:00', end: '23:00', startsAt, endsAt: midnight,
  });
  await f.leave(tenant, id, {
    kind: 'FULL_DAY', status, from: '2026-10-05', to: '2026-10-05', start: null, end: null,
    timezone: 'Asia/Dubai', startsAt: midnight, endsAt: new Date('2026-10-05T20:00:00Z'),
  });
  f.setNow(new Date('2026-10-04T21:20:00Z'));
  const count = status === 'APPROVED' ? 0 : 1;
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: count });
  expect(await f.notices(tenant.company, id)).toHaveLength(count);
  expect(await f.events(tenant.company)).toHaveLength(count);
});

it('split shifts are checked separately and each start is alerted once while it is running', async () => {
  const tenant = await f.tenant();
  const id = await f.employee(tenant, { nameEn: 'Split' });
  await f.shift(tenant, id, {
    startsAt: new Date('2026-10-04T07:00:00.000Z'),
    endsAt: new Date('2026-10-04T09:00:00.000Z'),
    start: '10:00',
    end: '12:00',
  });
  await f.shift(tenant, id, {
    startsAt: new Date('2026-10-04T09:00:00.000Z'),
    endsAt: new Date('2026-10-04T11:00:00.000Z'),
    start: '12:00',
    end: '14:00',
  });
  f.setNow(ALERT_AT);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  f.setNow(new Date('2026-10-04T09:20:00.000Z'));
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  expect(await f.notices(tenant.company, id)).toHaveLength(2);
});
