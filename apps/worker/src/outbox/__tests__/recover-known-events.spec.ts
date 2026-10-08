import { readFileSync } from 'node:fs';

import {
  createDatabase,
  createOutboxDispatcherDatabase,
  type Database,
  type OutboxDispatcherDatabase,
} from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { seedTwoTenants, TENANT } from '../../../../../packages/db/test/tenancy-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../packages/db/test/test-database.ts';
import { createDeliverer } from '../deliver.ts';
import { KNOWN_EVENT_TYPES } from '../known-event-types.ts';

const recovery = readFileSync(
  new URL(
    '../../../../../packages/db/migrations/0089_2026-10-08_recover-known-outbox-events.sql',
    import.meta.url,
  ),
  'utf8',
);
const ids = systemUuidV7();
let testDb: TestDatabase;
let app: Database;
let dispatcher: OutboxDispatcherDatabase;
let owner: postgres.Sql;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  app = createDatabase({ url: testDb.appUrl, ids });
  dispatcher = createOutboxDispatcherDatabase({ url: testDb.dispatcherUrl });
});

afterAll(async () => {
  await dispatcher?.close();
  await app?.close();
  await owner?.end();
  await testDb?.drop();
});

async function seedBlockedEvents(eventType: string) {
  const aggregate = ids.newId();
  const head = ids.newId();
  const later = ids.newId();
  const unrelated = ids.newId();
  const published = ids.newId();
  const retrying = ids.newId();
  await owner`
    INSERT INTO outbox (company_id, id, aggregate_type, aggregate_id, event_type, payload,
                        attempts, next_attempt_at, last_error, parked_at, published_at)
    VALUES
      (${TENANT.A.company}, ${head}, 'employee', ${aggregate}, ${eventType}, '{}',
       10, clock_timestamp() + interval '1 day', 'TypeError', clock_timestamp(), NULL),
      (${TENANT.A.company}, ${later}, 'employee', ${aggregate}, 'EmployeePasskeyUnbound', '{}',
       0, clock_timestamp(), NULL, NULL, NULL),
      (${TENANT.B.company}, ${unrelated}, 'employee', ${ids.newId()}, 'UnrelatedEvent', '{}',
       10, clock_timestamp() + interval '1 day', 'TypeError', clock_timestamp(), NULL),
      (${TENANT.B.company}, ${published}, 'employee', ${ids.newId()}, ${eventType}, '{}',
       10, clock_timestamp() + interval '1 day', 'TypeError', clock_timestamp(), clock_timestamp()),
      (${TENANT.B.company}, ${retrying}, 'employee', ${ids.newId()}, ${eventType}, '{}',
       3, clock_timestamp() + interval '1 day', 'TypeError', NULL, NULL)`;
  return { head, later, untouched: [unrelated, published, retrying] };
}

const state = (id: string) => owner`
  SELECT *, next_attempt_at <= clock_timestamp() AS ready FROM outbox WHERE id = ${id}`;

it.each([
  'SalaryChanged',
  'LeaveRequested',
  'LeaveCancelled',
  'LeaveApproved',
  'LeaveRejected',
  'LeaveRevoked',
  'EmployeePasskeyBound',
])('recovers parked %s and releases the next employee event without effects', async (eventType) => {
  const { head, later, untouched } = await seedBlockedEvents(eventType);
  const before = await Promise.all(untouched.map(state));
  const withTenant = vi.spyOn(app, 'withTenant');
  const deliver = vi.fn(
    createDeliverer(app, [], createLogger('silent'), {
      knownEventTypes: KNOWN_EVENT_TYPES,
    }),
  );
  expect(await dispatcher.dispatchBatch(100, deliver)).toBe(0);

  await owner.unsafe(recovery);
  const recovered = await state(head);
  expect(recovered).toMatchObject([
    {
      parked_at: null,
      published_at: null,
      attempts: 0,
      last_error: null,
      ready: true,
    },
  ]);
  await owner.unsafe(recovery);
  expect(await state(head)).toEqual(recovered);
  expect(await Promise.all(untouched.map(state))).toEqual(before);

  expect(await dispatcher.dispatchBatch(100, deliver)).toBe(1);
  expect(deliver.mock.calls.map(([event]) => event.id)).toEqual([head]);
  expect(await state(head)).toMatchObject([
    {
      published_at: expect.any(Date),
      parked_at: null,
      attempts: 1,
      last_error: null,
    },
  ]);
  expect(await state(later)).toMatchObject([{ published_at: null, attempts: 0 }]);
  expect(await dispatcher.dispatchBatch(100, deliver)).toBe(1);
  expect(deliver.mock.calls.map(([event]) => event.id)).toEqual([head, later]);
  expect(await state(later)).toMatchObject([{ published_at: expect.any(Date), attempts: 1 }]);
  expect(await Promise.all(untouched.map(state))).toEqual(before);
  expect(withTenant).not.toHaveBeenCalled();
  withTenant.mockRestore();
});
