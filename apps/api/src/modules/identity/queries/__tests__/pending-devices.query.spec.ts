import { pendingDevicesResponse, type PendingDevicesQuery } from '@pospay/contracts';
import { createDatabase, type Database, type TenantWrappers, type Tx } from '@pospay/db';
import { computeDeviceCheckCode } from '@pospay/domain';
import { sql, type SQL } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedTwoTenants, TENANT } from '../../../../../../../packages/db/test/tenancy-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../../packages/db/test/test-database.ts';
import { listPendingDevices, PendingDevicesCursorError } from '../pending-devices.query.ts';

// CLAUDE.md §9: the pending-device read has a result-shape test and an EXPLAIN ANALYZE assertion on a seeded dataset.
const { A, B } = TENANT;
const APPROVER = '01920000-0000-7000-8000-0000000000f2';
const CAP_BRANCH = '01920000-0000-7000-8000-0000000000f3';
const CAP_COUNT = 150;

type DeviceIdRow = {
  readonly id: string;
};

const deviceId = (n: number): string =>
  `01920000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;

const PENDING_OLD = deviceId(1);
const PENDING_NEW = deviceId(2);
const ACTIVE = deviceId(3);
const REVOKED = deviceId(4);
const OTHER_TENANT = deviceId(5);
const ACTIVE_SEEN = deviceId(6);

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
    INSERT INTO devices (company_id, id, branch_id, label, status, created_at, approved_by, approved_at, last_seen_at)
    VALUES (${A.company}, ${ACTIVE_SEEN}, ${A.branch}, 'Seen till', 'ACTIVE',
            '2026-03-01T12:00:00Z'::timestamptz, ${APPROVER}, '2026-03-01T00:00:00Z'::timestamptz,
            '2026-03-02T09:30:00Z'::timestamptz)`;
  await owner`
    INSERT INTO devices (company_id, id, branch_id, label, status, created_at, revoked_by, revoked_at)
    VALUES (${A.company}, ${REVOKED}, ${A.branch}, 'Revoked till', 'REVOKED',
            '2026-03-02T00:00:00Z'::timestamptz, ${APPROVER}, '2026-03-02T00:00:00Z'::timestamptz)`;
  await owner`
    INSERT INTO devices (company_id, id, branch_id, label, status, created_at)
    SELECT ${A.company}, ('01920000-0000-7000-8000-' || lpad(to_hex(n + 99), 12, '0'))::uuid,
           ${CAP_BRANCH}, 'Cap till', 'PENDING', '2026-01-01T00:00:00Z'::timestamptz + (n || ' seconds')::interval
    FROM generate_series(1, ${CAP_COUNT}) n`;
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

function inTenant<T>(companyId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.withTenant(companyId, fn);
}

function pending(companyId: string, branchId: string, query: PendingDevicesQuery) {
  return inTenant(companyId, (tx) => listPendingDevices(tx, companyId, branchId, query));
}

const firstPage: PendingDevicesQuery = { status: 'pending', limit: 20 };

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

describe('listPendingDevices — rows and isolation', () => {
  it('returns the branch pending devices newest first, with the check code and nothing else', async () => {
    const body = pendingDevicesResponse.parse(await pending(A.company, A.branch, firstPage));
    expect(body.items.map((device) => device.id)).toEqual([PENDING_NEW, PENDING_OLD]);
    expect(body.items[0]).toEqual({
      id: PENDING_NEW,
      label: 'New till',
      created_at: '2026-02-01T00:00:00.000000Z',
      check_code: computeDeviceCheckCode(PENDING_NEW),
      last_seen_at: null,
    });
    expect(Object.keys(body.items[0] ?? {}).sort()).toEqual([
      'check_code',
      'created_at',
      'id',
      'label',
      'last_seen_at',
    ]);
    expect(body.next_cursor).toBeNull();
  });

  it('gives every pending device its own check code', async () => {
    const body = await pending(A.company, A.branch, firstPage);
    const codes = body.items.map((device) => device.check_code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('leaves the active and the revoked device out, and shows another tenant nothing', async () => {
    const body = await pending(A.company, A.branch, firstPage);
    expect(JSON.stringify(body)).not.toContain(ACTIVE);
    expect(JSON.stringify(body)).not.toContain(REVOKED);
    expect(JSON.stringify(body)).not.toContain(OTHER_TENANT);
    const there = await pending(B.company, B.branch, firstPage);
    expect(there.items.map((device) => device.id)).toEqual([OTHER_TENANT]);
    expect(await pending(A.company, B.branch, firstPage)).toEqual({ items: [], next_cursor: null });
  });

  it('RLS hides another tenant device even without a company filter', async () => {
    const ids = await inTenant(A.company, async (tx) => {
      const rows = await tx.execute<DeviceIdRow>(sql`SELECT id FROM devices`);
      return Array.from(rows).map((row) => row.id);
    });
    expect(ids).toContain(PENDING_NEW);
    expect(ids).not.toContain(OTHER_TENANT);
  });

  it('RLS hides the other company’s pending and active devices from both statuses', async () => {
    const ids = await inTenant(B.company, async (tx) => {
      const rows = await tx.execute<DeviceIdRow>(sql`SELECT id FROM devices`);
      return Array.from(rows).map((row) => row.id);
    });
    expect(ids).toContain(OTHER_TENANT);
    expect(ids).not.toContain(PENDING_NEW);
    expect(ids).not.toContain(PENDING_OLD);
    expect(ids).not.toContain(ACTIVE);
    expect(ids).not.toContain(ACTIVE_SEEN);
    expect((await pending(B.company, A.branch, firstPage)).items).toEqual([]);
    expect(
      (await pending(B.company, A.branch, { status: 'active', limit: 20 })).items,
    ).toEqual([]);
  });
});

describe('listPendingDevices — the active devices', () => {
  const activePage: PendingDevicesQuery = { status: 'active', limit: 20 };

  it('returns the active devices with the last contact and no check code', async () => {
    const body = pendingDevicesResponse.parse(await pending(A.company, A.branch, activePage));
    expect(body.items.map((device) => device.id)).toEqual([ACTIVE_SEEN, ACTIVE]);
    expect(body.items[0]).toEqual({
      id: ACTIVE_SEEN,
      label: 'Seen till',
      created_at: '2026-03-01T12:00:00.000000Z',
      check_code: null,
      last_seen_at: '2026-03-02T09:30:00.000000Z',
    });
    expect(body.items[1]?.last_seen_at).toBeNull();
    expect(body.next_cursor).toBeNull();
  });

  it('shows another tenant nothing, and hides its active devices from this company', async () => {
    expect(await pending(B.company, A.branch, activePage)).toEqual({ items: [], next_cursor: null });
    expect(await pending(A.company, B.branch, activePage)).toEqual({ items: [], next_cursor: null });
  });

  it('refuses a cursor made for the other status', async () => {
    const page = await pending(A.company, A.branch, { status: 'pending', limit: 1 });
    expect(page.next_cursor).not.toBeNull();
    await expect(
      pending(A.company, A.branch, {
        status: 'active',
        limit: 20,
        cursor: page.next_cursor ?? '',
      }),
    ).rejects.toThrow(PendingDevicesCursorError);
  });

  it('EXPLAIN ANALYZE looks the devices up by index and never scans them sequentially', async () => {
    plans.length = 0;
    await explaining(db).withTenant(A.company, (tx) =>
      listPendingDevices(tx, A.company, A.branch, activePage),
    );
    const plan = plans.find((entry) => entry.includes('devices')) ?? '';
    expect(plan).toMatch(/devices_(company_id_branch_id_idx|company_branch_id_key)/);
    expect(plan).not.toContain('Seq Scan');
  });
});
describe('listPendingDevices — paging', () => {
  it('pages through every pending device with a cursor, each one exactly once', async () => {
    const ids: string[] = [];
    const cursors: (string | null)[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const query: PendingDevicesQuery =
        cursor === undefined
          ? { status: 'pending', limit: 50 }
          : { status: 'pending', limit: 50, cursor };
      const body = await pending(A.company, CAP_BRANCH, query);
      ids.push(...body.items.map((device) => device.id));
      cursors.push(body.next_cursor);
      if (body.next_cursor === null) break;
      cursor = body.next_cursor;
    }
    expect(ids).toHaveLength(CAP_COUNT);
    expect(new Set(ids).size).toBe(CAP_COUNT);
    expect(ids).toEqual(
      Array.from({ length: CAP_COUNT }, (_, index) => deviceId(99 + CAP_COUNT - index)),
    );
    expect(cursors.at(-1)).toBeNull();
  });

  it('keeps the check code of every device the same on every page', async () => {
    const first = await pending(A.company, CAP_BRANCH, { status: 'pending', limit: 50 });
    const second = await pending(A.company, CAP_BRANCH, {
      status: 'pending',
      limit: 50,
      cursor: first.next_cursor ?? '',
    });
    for (const item of second.items) {
      expect(item.check_code).toBe(computeDeviceCheckCode(item.id));
    }
  });
});

describe('listPendingDevices — cursors and plan', () => {
  it('refuses a cursor made for another branch', async () => {
    const page = await pending(A.company, CAP_BRANCH, { status: 'pending', limit: 1 });
    expect(page.next_cursor).not.toBeNull();
    await expect(
      pending(A.company, A.branch, {
        status: 'pending',
        limit: 20,
        cursor: page.next_cursor ?? '',
      }),
    ).rejects.toThrow(PendingDevicesCursorError);
  });

  it('refuses a cursor made for another company', async () => {
    const page = await pending(A.company, A.branch, { status: 'pending', limit: 1 });
    expect(page.next_cursor).not.toBeNull();
    await expect(
      pending(B.company, A.branch, {
        status: 'pending',
        limit: 20,
        cursor: page.next_cursor ?? '',
      }),
    ).rejects.toThrow(PendingDevicesCursorError);
  });

  it('EXPLAIN ANALYZE looks the devices up by index and never scans them sequentially', async () => {
    plans.length = 0;
    await explaining(db).withTenant(A.company, (tx) =>
      listPendingDevices(tx, A.company, A.branch, firstPage),
    );
    const plan = plans.find((entry) => entry.includes('devices')) ?? '';
    expect(plan).toMatch(/devices_(company_id_branch_id_idx|company_branch_id_key)/);
    expect(plan).not.toContain('Seq Scan');
  });
});
