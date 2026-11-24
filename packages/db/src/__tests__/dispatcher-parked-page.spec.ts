import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TENANT, seedTwoTenants } from '../../test/tenancy-fixtures.ts';
import { withClusterRoleLock } from '../../test/role-lock.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createOutboxDispatcherDatabase } from '../index.ts';

// ADR-0012 §3 (53-2 B2b): the parked page is a read on the dispatcher role only. The dispatcher keeps
// SELECT on outbox and nothing else, and the page reads no payload.
const COUNTED = 'SalaryChanged';
const OTHER = 'OrderCompleted';

let testDb: TestDatabase;
let owner: postgres.Sql;
let raw: postgres.Sql;

const eventId = (n: number): string =>
  `01970000-0000-7000-8000-${String(n).padStart(12, '0')}`;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  raw = postgres(testDb.dispatcherUrl, { max: 1, onnotice: () => undefined });
  await owner`
    INSERT INTO outbox (company_id, id, aggregate_type, aggregate_id, event_type, payload, parked_at)
    VALUES (${TENANT.A.company}, ${eventId(1)}, 'service_session', ${TENANT.A.business}, ${COUNTED},
      '{"amount":100}'::jsonb, clock_timestamp())`;
  await owner`
    INSERT INTO outbox (company_id, id, aggregate_type, aggregate_id, event_type, payload, parked_at)
    VALUES (${TENANT.B.company}, ${eventId(2)}, 'service_session', ${TENANT.B.business}, ${COUNTED},
      '{}'::jsonb, clock_timestamp())`;
  await owner`
    INSERT INTO outbox (company_id, id, aggregate_type, aggregate_id, event_type, payload, parked_at)
    VALUES (${TENANT.A.company}, ${eventId(3)}, 'service_session', ${TENANT.A.business}, ${OTHER},
      '{}'::jsonb, clock_timestamp())`;
  await owner`
    INSERT INTO outbox (company_id, id, aggregate_type, aggregate_id, event_type, payload)
    VALUES (${TENANT.A.company}, ${eventId(4)}, 'service_session', ${TENANT.A.business}, ${COUNTED},
      '{}'::jsonb)`;
});

afterAll(async () => {
  await raw.end();
  await owner.end();
  await testDb.drop();
});

describe('the parked commission page', () => {
  it('reads the parked rows of the counted types across tenants, without a payload', async () => {
    const dispatcher = createOutboxDispatcherDatabase({ url: testDb.dispatcherUrl });
    try {
      const page = await dispatcher.commissionParkedEventPage('0', 100);
      expect(page.map((row) => row.id).sort()).toEqual([eventId(1), eventId(2)]);
      expect(page.map((row) => row.companyId).sort()).toEqual(
        [TENANT.A.company, TENANT.B.company].sort(),
      );
      for (const row of page) {
        expect(Object.keys(row).sort()).toEqual(['companyId', 'eventType', 'id', 'seq']);
        expect(row.eventType).toBe(COUNTED);
      }
    } finally {
      await dispatcher.close();
    }
  });

  it('pages by the numeric cursor, not by the text of it', async () => {
    const dispatcher = createOutboxDispatcherDatabase({ url: testDb.dispatcherUrl });
    try {
      const first = await dispatcher.commissionParkedEventPage('0', 1);
      expect(first).toHaveLength(1);
      const next = await dispatcher.commissionParkedEventPage(first[0]?.seq as string, 1);
      expect(next).toHaveLength(1);
      expect(next[0]?.id).not.toBe(first[0]?.id);
    } finally {
      await dispatcher.close();
    }
  });

  it('refuses any other role before any work', async () => {
    await withClusterRoleLock('shared', async () => {
      const wrong = createOutboxDispatcherDatabase({ url: testDb.appUrl });
      try {
        await expect(wrong.commissionParkedEventPage('0', 100)).rejects.toThrow(
          /must connect as pospay_dispatcher/,
        );
      } finally {
        await wrong.close();
      }
    });
  });

  it('gives the dispatcher no privilege on consumed_events', async () => {
    await expect(raw`SELECT 1 FROM consumed_events`).rejects.toThrow(/permission denied/);
  });
});
