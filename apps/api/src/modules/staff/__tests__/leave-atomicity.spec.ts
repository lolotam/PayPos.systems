import type { TenantWrappers, Tx } from '@pospay/db';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  leaveActor,
  leaveFixture,
  leaveTerms,
  leaveIds,
  type LeaveFixture,
} from './leave.fixture.ts';
import { createLeaveTransactions } from '../persistence/drizzle-leave-transactions.ts';
import { RequestLeaveUseCase } from '../use-cases/request-leave/request-leave.usecase.ts';
import { CancelLeaveUseCase } from '../use-cases/cancel-leave/cancel-leave.usecase.ts';
let f: LeaveFixture;
beforeAll(async () => {
  f = await leaveFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
function failOutbox(tx: Tx): Tx {
  const dialect = new PgDialect();
  return new Proxy(tx, {
    get: (target, property, receiver) =>
      property === 'execute'
        ? (query: SQL) => {
            if (dialect.sqlToQuery(query).sql.trimStart().startsWith('INSERT INTO outbox'))
              throw new Error('SYNTHETIC_OUTBOX_FAILURE');
            return target.execute(query);
          }
        : Reflect.get(target, property, receiver),
  });
}
function failingTransactions() {
  const database: TenantWrappers = {
    ...f.db,
    withTenant: (company, work, options) =>
      f.db.withTenant(company, (tx) => work(failOutbox(tx)), options),
  };
  return createLeaveTransactions(database, leaveIds);
}
it('outbox failure rolls request, audit and idempotency claim back together', async () => {
  const useCase = new RequestLeaveUseCase(failingTransactions(), leaveIds, f.clock);
  const actor = leaveActor(f);
  await expect(useCase.execute(actor, leaveTerms())).rejects.toThrow('LEAVE_PERSISTENCE_FAILED');
  expect(await f.h.owner`SELECT id FROM leave_requests WHERE company_id=${f.company}`).toHaveLength(
    0,
  );
  expect(
    await f.h
      .owner`SELECT id FROM audit_log WHERE company_id=${f.company} AND entity='leave_request'`,
  ).toHaveLength(0);
  expect(
    await f.h
      .owner`SELECT id FROM outbox WHERE company_id=${f.company} AND event_type='LeaveRequested'`,
  ).toHaveLength(0);
  await expect(f.request.execute(actor, leaveTerms())).resolves.toMatchObject({
    status: 'PENDING',
    revision: 1,
  });
});
it('outbox failure rolls cancellation and revision back; same key can safely retry', async () => {
  const made = await f.request.execute(leaveActor(f), leaveTerms('2027-02-01'));
  const actor = { ...leaveActor(f), leaveId: made.id };
  const useCase = new CancelLeaveUseCase(failingTransactions(), f.clock);
  await expect(useCase.execute(actor, { expected_revision: 1 })).rejects.toThrow(
    'LEAVE_PERSISTENCE_FAILED',
  );
  expect(
    await f.h
      .owner`SELECT status,revision FROM leave_requests WHERE company_id=${f.company} AND id=${made.id}`,
  ).toEqual([{ status: 'PENDING', revision: 1 }]);
  expect(
    await f.h
      .owner`SELECT id FROM audit_log WHERE company_id=${f.company} AND entity_id=${made.id}`,
  ).toHaveLength(1);
  expect(
    await f.h
      .owner`SELECT id FROM outbox WHERE company_id=${f.company} AND aggregate_id=${made.id}`,
  ).toHaveLength(1);
  await expect(f.cancel.execute(actor, { expected_revision: 1 })).resolves.toMatchObject({
    status: 'CANCELLED',
    revision: 2,
  });
});
