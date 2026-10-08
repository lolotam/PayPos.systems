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
