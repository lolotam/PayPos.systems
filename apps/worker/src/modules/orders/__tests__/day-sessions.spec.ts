import { beforeAll, afterAll, expect, it } from 'vitest';
import { ORDER_IDS } from '../../../../../../packages/db/test/orders-fixture.ts';
import { TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { listActiveLinesOfCustomer } from '../queries/day-sessions.query.ts';
import { daySessionsFixture, type DaySessionsFixture } from './day-sessions.fixture.ts';

let f: DaySessionsFixture;
beforeAll(async () => {
  f = await daySessionsFixture();
});
afterAll(async () => {
  await f?.close();
});

const CUSTOMER = ORDER_IDS.customer;

it('reads the active lines with the session recording time and the performers in ordinal order', async () => {
  const occurredAt = new Date('2026-05-05T09:00:00.000Z');
  const recordedAt = new Date('2026-05-05T09:05:00.000Z');
  const session = await f.session({ occurredAt, recordedAt });
  const employee = await f.addEmployee();
  await f.addPerformer(session.lineId, employee, 2, 4000);
  const lines = await read(f.tenant.business, CUSTOMER, occurredAt, hour(occurredAt));
  expect(lines).toHaveLength(1);
  const line = lines[0];
  expect(line?.lineId).toBe(session.lineId);
  expect(line?.sessionId).toBe(session.sessionId);
  expect(line?.branchId).toBe(f.tenant.branch);
  expect(line?.occurredAt).toEqual(occurredAt);
  expect(line?.recordedAt).toEqual(recordedAt);
  expect(line?.businessTimezone).toBe('Asia/Kuwait');
  expect(line?.performers).toEqual([
    { employeeId: ORDER_IDS.employee, shareBps: 10000 },
    { employeeId: employee, shareBps: 4000 },
  ]);
});

it('leaves out the cancelled lines and the sessions without an active line', async () => {
  const occurredAt = new Date('2026-05-06T09:00:00.000Z');
  const mixed = await f.session({ occurredAt });
  await f.addLine(mixed.sessionId, 'CANCELLED');
  const dead = await f.session({ occurredAt });
  await f.cancelLine(dead.lineId);
  const lines = await read(f.tenant.business, CUSTOMER, occurredAt, hour(occurredAt));
  expect(lines.map((line) => line.lineId)).toEqual([mixed.lineId]);
});

it('includes the session at the window start and leaves out the one at its end', async () => {
  const from = new Date('2026-05-07T09:00:00.000Z');
  const to = new Date('2026-05-07T10:00:00.000Z');
  const inside = await f.session({ occurredAt: from });
  const outside = await f.session({ occurredAt: to });
  const lines = await read(f.tenant.business, CUSTOMER, from, to);
  expect(lines.map((line) => line.sessionId)).toEqual([inside.sessionId]);
  expect(lines.map((line) => line.sessionId)).not.toContain(outside.sessionId);
});

it('leaves out the sessions of another customer and of another business', async () => {
  const occurredAt = new Date('2026-05-08T09:00:00.000Z');
  const customer = await f.addCustomer();
  const foreign = await f.session({ occurredAt, customerId: customer });
  const business = await f.addBusiness();
  const other = await f.session({ occurredAt, businessId: business.businessId });
  expect(await read(f.tenant.business, CUSTOMER, occurredAt, hour(occurredAt))).toHaveLength(0);
  const byCustomer = await read(f.tenant.business, customer, occurredAt, hour(occurredAt));
  expect(byCustomer.map((line) => line.sessionId)).toEqual([foreign.sessionId]);
  const byBusiness = await read(business.businessId, CUSTOMER, occurredAt, hour(occurredAt));
  expect(byBusiness.map((line) => line.sessionId)).toEqual([other.sessionId]);
});

it('never shows another tenant and reads nothing when the company is not the transaction tenant', async () => {
  const occurredAt = new Date('2026-05-09T09:00:00.000Z');
  await f.session({ occurredAt });
  expect(await read(f.tenant.business, CUSTOMER, occurredAt, hour(occurredAt))).toHaveLength(1);
  const foreign = await f.db.withTenant(TENANT.B.company, (tx) =>
    listActiveLinesOfCustomer(
      tx,
      TENANT.A.company,
      TENANT.A.business,
      CUSTOMER,
      occurredAt,
      hour(occurredAt),
    ),
  );
  expect(foreign).toHaveLength(0);
  const mismatch = await f.db.withTenant(f.tenant.company, (tx) =>
    listActiveLinesOfCustomer(
      tx,
      TENANT.B.company,
      TENANT.B.business,
      CUSTOMER,
      occurredAt,
      hour(occurredAt),
    ),
  );
  expect(mismatch).toHaveLength(0);
});

function read(businessId: string, customerId: string, from: Date, to: Date) {
  return f.db.withTenant(f.tenant.company, (tx) =>
    listActiveLinesOfCustomer(tx, f.tenant.company, businessId, customerId, from, to),
  );
}

function hour(instant: Date): Date {
  return new Date(instant.getTime() + 3_600_000);
}
