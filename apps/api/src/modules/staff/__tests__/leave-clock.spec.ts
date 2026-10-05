import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { TenantWrappers, Tx } from '@pospay/db';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { addScheduleDays } from '../domain/schedule-calendar.ts';
import { employeeLeaveHistory } from '../queries/leave-requests.query.ts';
import { leaveActor, leaveFixture, leaveTerms, type LeaveFixture } from './leave.fixture.ts';
import { leaveIds } from './leave.fixture.ts';
import { createLeaveTransactions } from '../persistence/drizzle-leave-transactions.ts';
import { RequestLeaveUseCase } from '../use-cases/request-leave/request-leave.usecase.ts';

let f: LeaveFixture;
beforeAll(async () => {
  f = await leaveFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
afterEach(() => vi.restoreAllMocks());

it('uses one frozen contract-end-day instant for authority, own eligibility, period, reads and cancellation despite the next DB day', async () => {
  const [db] = await f.h
    .owner`SELECT (clock_timestamp() AT TIME ZONE 'Asia/Kuwait')::date::text AS today`;
  const databaseToday = db?.['today'] as string;
  const contractEnd = addScheduleDays(databaseToday, -1);
  const frozen = new Date(`${contractEnd}T09:00:00Z`);
  await f.h
    .owner`UPDATE employees SET contract_end=${contractEnd} WHERE company_id=${f.company} AND id=${f.employee.id}`;
  await f.h
    .owner`UPDATE memberships SET starts_at='2000-01-01T00:00:00Z',ends_at=${databaseToday + 'T00:00:00Z'} WHERE company_id=${f.company} AND user_id=${f.userId}`;
  const clock = vi.spyOn(f.clock, 'now').mockReturnValue(frozen);
  const actor = { ...leaveActor(f), own: true };
  const made = await f.request.execute(actor, leaveTerms(contractEnd));
  expect(made).toMatchObject({ from: contractEnd, requested_at: frozen.toISOString() });
  expect(clock).toHaveBeenCalledTimes(1);
  clock.mockClear();
  const history = await f.db.withTenant(f.company, (tx) =>
    employeeLeaveHistory(tx, actor, { limit: 20 }, f.access),
  );
  expect(history).toMatchObject({ items: [expect.objectContaining({ id: made.id })] });
  expect(clock).toHaveBeenCalledTimes(1);
  clock.mockClear();
  const cancelled = await f.cancel.execute(
    { ...actor, leaveId: made.id },
    { expected_revision: 1 },
  );
  expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelled_at: frozen.toISOString() });
  expect(clock).toHaveBeenCalledTimes(1);
});

function authorityWait() {
  let entered!: () => void;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const dialect = new PgDialect();
  const proxy = (tx: Tx): Tx =>
    new Proxy(tx, {
      get: (target, property, receiver) =>
        property === 'execute'
          ? async (query: SQL) => {
              if (dialect.sqlToQuery(query).sql.includes('FOR NO KEY UPDATE')) {
                entered();
                await held;
              }
              return target.execute(query);
            }
          : Reflect.get(target, property, receiver),
    });
  const database: TenantWrappers = {
    ...f.db,
    withTenant: (company, work, options) =>
      f.db.withTenant(company, (tx) => work(proxy(tx)), options),
  };
  return {
    transactions: createLeaveTransactions(database, leaveIds),
    waiting,
    release: () => release(),
  };
}

it('samples once after an authority wait and refuses permission that expired while queued', async () => {
  const initial = new Date('2026-10-04T10:00:00Z');
  const expired = new Date('2026-10-04T10:01:00Z');
  await f.h
    .owner`UPDATE employees SET contract_end=NULL WHERE company_id=${f.company} AND id=${f.employee.id}`;
  await f.h
    .owner`UPDATE memberships SET ends_at='2026-10-04T10:00:30Z' WHERE company_id=${f.company} AND id=${f.memberId}`;
  const clock = vi.spyOn(f.clock, 'now').mockReturnValue(initial);
  const gate = authorityWait();
  const request = new RequestLeaveUseCase(gate.transactions, leaveIds, f.clock);
  const result = request.execute(leaveActor(f), leaveTerms()).then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  try {
    await gate.waiting;
    expect(clock).not.toHaveBeenCalled();
    clock.mockReturnValue(expired);
  } finally {
    gate.release();
    await result;
  }
  expect(await result).toMatchObject({ error: { code: 'NOT_FOUND' } });
  expect(clock).toHaveBeenCalledTimes(1);
});
