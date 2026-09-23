import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TENANT, seedTwoTenants } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createOutboxDispatcherDatabase } from '../index.ts';

// ADR-0003 §3: pospay_dispatcher reads outbox across tenants and nothing else, may change only the delivery
// metadata, and runs the idempotency sweep through its one SECURITY DEFINER function.
let testDb: TestDatabase;
let owner: postgres.Sql;
let raw: postgres.Sql;
const EVENT = '01980000-0000-7000-8000-000000000001';

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  raw = postgres(testDb.dispatcherUrl, { max: 1, onnotice: () => undefined });
  await owner`
    INSERT INTO outbox (company_id, id, aggregate_type, aggregate_id, event_type, payload)
    VALUES (${TENANT.B.company}, ${EVENT}, 'business', ${TENANT.B.business}, 'BusinessCreated', '{}')`;
});

afterAll(async () => {
  await raw.end();
  await owner.end();
  await testDb.drop();
});

describe('pospay_dispatcher', () => {
  it('reads outbox rows of every tenant', async () => {
    expect(await raw`SELECT company_id FROM outbox WHERE id = ${EVENT}`).toEqual([
      { company_id: TENANT.B.company },
    ]);
  });

  it.each([
    'companies',
    'businesses',
    'branches',
    'audit_log',
    'idempotency_keys',
    'consumed_events',
    'plans',
  ])('cannot read %s', async (table) => {
    await expect(raw.unsafe(`SELECT 1 FROM ${table}`)).rejects.toThrow(/permission denied/);
  });

  it.each([
    ['payload', `'{"forged":true}'`],
    ['company_id', `'${TENANT.A.company}'`],
    ['id', `'01980000-0000-7000-8000-0000000000ff'`],
    ['event_type', `'Forged'`],
    ['aggregate_id', `'${TENANT.A.business}'`],
  ])('cannot change %s', async (column, value) => {
    await expect(raw.unsafe(`UPDATE outbox SET ${column} = ${value}`)).rejects.toThrow(
      /permission denied/,
    );
  });

  it('can record delivery metadata, and cannot insert or delete events', async () => {
    await raw`UPDATE outbox SET attempts = attempts + 1, last_error = 'x' WHERE id = ${EVENT}`;
    await expect(raw`DELETE FROM outbox`).rejects.toThrow(/permission denied/);
    await expect(
      raw`INSERT INTO outbox (company_id, id, aggregate_type, aggregate_id, event_type, payload)
          VALUES (${TENANT.A.company}, ${EVENT}, 'business', ${TENANT.A.business}, 'X', '{}')`,
    ).rejects.toThrow(/permission denied/);
  });
});

describe('the facade refuses any other role', () => {
  it('ping() answers as pospay_dispatcher and refuses any other role — /ready uses it', async () => {
    const right = createOutboxDispatcherDatabase({ url: testDb.dispatcherUrl });
    const wrong = createOutboxDispatcherDatabase({ url: testDb.appUrl });
    try {
      await expect(right.ping()).resolves.toBeUndefined();
      await expect(wrong.ping()).rejects.toThrow(/must connect as pospay_dispatcher/);
    } finally {
      await Promise.all([right.close(), wrong.close()]);
    }
  });

  it('pospay_app behind the dispatcher facade is refused before any work', async () => {
    const wrong = createOutboxDispatcherDatabase({ url: testDb.appUrl });
    try {
      await expect(wrong.dispatchBatch(1, async () => ({ delivered: true }))).rejects.toThrow(
        /must connect as pospay_dispatcher/,
      );
    } finally {
      await wrong.close();
    }
  });
});

describe('the idempotency sweep', () => {
  it('deletes expired keys of every tenant and keeps live ones', async () => {
    const insert = (key: string, expired: boolean) => owner`
      INSERT INTO idempotency_keys (scope_type, scope_id, company_id, operation, key, request_fingerprint,
                                    response_status, response_body, created_at, expires_at)
      VALUES ('COMPANY', ${TENANT.A.company}, ${TENANT.A.company}, 'create-business', ${key}, ${'f'.repeat(64)},
              201, '{}', now() - interval '2 days',
              ${expired ? owner`now() - interval '1 hour'` : owner`now() + interval '1 hour'`})`;
    await insert('expired-key', true);
    await insert('live-key', false);
    const sweeper = createOutboxDispatcherDatabase({ url: testDb.dispatcherUrl });
    try {
      expect(await sweeper.sweepExpiredIdempotencyKeys(100)).toBe(1);
    } finally {
      await sweeper.close();
    }
    const left = await owner`SELECT key FROM idempotency_keys ORDER BY key`;
    expect(left.map((r) => r['key'])).toEqual(['live-key']);
  });

  it('no other application role may run it', async () => {
    const appSql = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
    try {
      await expect(appSql`SELECT sweep_expired_idempotency_keys(1)`).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await appSql.end();
    }
  });
});
