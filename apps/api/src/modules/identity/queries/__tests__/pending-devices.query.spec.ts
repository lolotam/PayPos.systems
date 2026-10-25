import { pendingDevicesResponse } from '@pospay/contracts';
import {
  createDatabase,
  type Database,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedTwoTenants, TENANT } from '../../../../../../../packages/db/test/tenancy-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../../packages/db/test/test-database.ts';
import { listPendingDevices } from '../pending-devices.query.ts';

// CLAUDE.md §9: the pending-device read has a result-shape test and an EXPLAIN ANALYZE assertion on a seeded dataset.
const { A, B } = TENANT;
const APPROVER = '01920000-0000-7000-8000-0000000000f2';
const CAP_BRANCH = '01920000-0000-7000-8000-0000000000f3';

const deviceId = (n: number): string =>
  `01920000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;

const PENDING_OLD = deviceId(1);
const PENDING_NEW = deviceId(2);
const ACTIVE = deviceId(3);
const REVOKED = deviceId(4);
const OTHER_TENANT = deviceId(5);

const plans: string[] = [];

let testDb: TestDatabase;
let db: Database;

function explaining(database: Database): TenantWrappers {
  const explain = (tx: Tx): Tx =>
    new Proxy(tx, {
      get: (target, property, receiver) =>
        property === 'execute'
          ? async (query: SQL) => {
              const [row] = await target.execute<{ plan: unknown }>(
                sql`EXPLAIN (ANALYZE, FORMAT JSON) ${query}`,
              );
              plans.push(JSON.stringify(Object.values(row ?? {})[0]));
              return target.execute(query);
            }
          : Reflect.get(target, property, receiver),
    });
  return {
    withUser: (userId, fn) => database.withUser(userId, (tx) => fn(explain(tx))),
    withNewTenant: (userId, fn) => database.withNewTenant(userId, (tx, id) => fn(explain(tx), id)),
    withMember: (userId, companyId, fn) =>
      database.withMember(userId, companyId, (tx) => fn(explain(tx))),
    withTenant: (companyId, fn, options) =>
      database.withTenant(companyId, (tx) => fn(explain(tx)), options),
  };
}

async function seed(owner: postgres.Sql): Promise<void> {
  await owner`INSERT INTO "user" (id, name, email)
    VALUES (${APPROVER}, 'Approver', 'approver@example.test')`;
  await owner`INSERT INTO branches (id, company_id, business_id, name_en)
    VALUES (${CAP_BRANCH}, ${A.company}, ${A.business}, 'Cap branch')`;
  await owner`
    INSERT INTO devices (company_id, id, branch_id, label, status, created_at)
    VALUES
      (${A.company}, ${PENDING_OLD}, ${A.branch}, 'Old till', 'PENDING', '2026-01-01T00:00:00Z'::timestamptz),
      (${A.company}, ${PENDING_NEW}, ${A.branch}, 'New till', 'PENDING', '2026-02-01T00:00:00Z'::timestamptz),
      (${B.company}, ${OTHER_TENANT}, ${B.branch}, 'Other tenant till', 'PENDING', '2026-04-01T00:00:00Z'::timestamptz)`;
  await owner`
    INSERT INTO devices (company_id, id, branch_id, label, status, created_at, approved_by, approved_at)
    VALUES (${A.company}, ${ACTIVE}, ${A.branch}, 'Active till', 'ACTIVE',
            '2026-03-01T00:00:00Z'::timestamptz, ${APPROVER}, '2026-03-01T00:00:00Z'::timestamptz)`;
  await owner`
    INSERT INTO devices (company_id, id, branch_id, label, status, created_at, revoked_by, revoked_at)
    VALUES (${A.company}, ${REVOKED}, ${A.branch}, 'Revoked till', 'REVOKED',
            '2026-03-02T00:00:00Z'::timestamptz, ${APPROVER}, '2026-03-02T00:00:00Z'::timestamptz)`;
  await owner`
    INSERT INTO devices (company_id, id, branch_id, label, status, created_at)
    SELECT ${A.company}, ('01920000-0000-7000-8000-' || lpad(to_hex(n + 99), 12, '0'))::uuid,
           ${CAP_BRANCH}, 'Cap till', 'PENDING', '2026-01-01T00:00:00Z'::timestamptz + (n || ' seconds')::interval
    FROM generate_series(1, 51) n`;
  await owner`
    INSERT INTO branches (id, company_id, business_id, name_en)
    SELECT gen_random_uuid(), ${A.company}, ${A.business}, 'Bulk branch ' || n
    FROM generate_series(1, 30) n`;
  await owner`
    INSERT INTO devices (company_id, id, branch_id, label, status, created_at)
    SELECT ${A.company}, gen_random_uuid(), b.id, 'Bulk till', 'PENDING',
           '2026-01-01T00:00:00Z'::timestamptz
    FROM branches b, generate_series(1, 100) n
    WHERE b.company_id = ${A.company} AND b.name_en LIKE 'Bulk branch %'`;
  await owner`ANALYZE devices`;
}

function pending(companyId: string, branchId: string) {
  return db.withTenant(companyId, (tx) => listPendingDevices(tx, companyId, branchId));
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  const owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await seed(owner);
  } finally {
    await owner.end();
  }
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => A.company } });
});

afterAll(async () => {
  await db.close();
  await testDb.drop();
});

describe('listPendingDevices', () => {
  it('returns the branch pending devices newest first, with nothing but id, label and created_at', async () => {
    const body = pendingDevicesResponse.parse(await pending(A.company, A.branch));
    expect(body.items.map((device) => device.id)).toEqual([PENDING_NEW, PENDING_OLD]);
    expect(body.items[0]).toEqual({
      id: PENDING_NEW,
      label: 'New till',
      created_at: '2026-02-01T00:00:00.000Z',
    });
    expect(Object.keys(body.items[0] ?? {}).sort()).toEqual(['created_at', 'id', 'label']);
  });

  it('leaves the active and the revoked device out, and shows another tenant nothing', async () => {
    const body = await pending(A.company, A.branch);
    expect(JSON.stringify(body)).not.toContain(ACTIVE);
    expect(JSON.stringify(body)).not.toContain(REVOKED);
    expect(JSON.stringify(body)).not.toContain(OTHER_TENANT);
    const there = await pending(B.company, B.branch);
    expect(there.items.map((device) => device.id)).toEqual([OTHER_TENANT]);
    expect(await pending(A.company, B.branch)).toEqual({ items: [] });
  });

  it('stops at fifty devices', async () => {
    const body = await pending(A.company, CAP_BRANCH);
    expect(body.items).toHaveLength(50);
    expect(body.items[0]?.id).toBe(deviceId(150));
    expect(body.items.at(-1)?.id).toBe(deviceId(101));
  });

  it('EXPLAIN ANALYZE looks the devices up by index and never scans them sequentially', async () => {
    plans.length = 0;
    await explaining(db).withTenant(A.company, (tx) =>
      listPendingDevices(tx, A.company, A.branch),
    );
    const plan = plans.find((entry) => entry.includes('devices')) ?? '';
    expect(plan).toMatch(/devices_(company_id_branch_id_idx|pkey)/);
    expect(plan).not.toContain('Seq Scan');
  });
});
