import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database } from '../index.ts';

// T9b-2: devices is tenant data (ADR-0003 §4 path B) — a forged company in a device token finds no row.
const { A, B } = TENANT;
const DEVICE_B = '01920000-0000-7000-8000-0000000000d7';
const NEW = '01920000-0000-7000-8000-0000000000d8';

let testDb: TestDatabase;
let db: Database;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  const owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await owner`INSERT INTO devices (company_id, id, branch_id, label, status, claim_hash)
                VALUES (${B.company}, ${DEVICE_B}, ${B.branch}, 'Till B', 'PENDING', 'x')`;
  } finally {
    await owner.end();
  }
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => NEW } });
});

afterAll(async () => {
  await db.close();
  await testDb.drop();
});

const asA = (query: ReturnType<typeof sql>) =>
  db.withTenant(A.company, async (tx) => Array.from(await tx.execute(query)));

describe('devices under RLS', () => {
  it("company A reads none of B's devices, even by id", async () => {
    expect(await asA(sql`SELECT id FROM devices`)).toEqual([]);
    expect(await asA(sql`SELECT id FROM devices WHERE id = ${DEVICE_B}`)).toEqual([]);
  });

  it("A cannot insert a device for B, nor change or revoke B's", async () => {
    await expect(
      asA(sql`INSERT INTO devices (company_id, id, branch_id, label, status, claim_hash)
              VALUES (${B.company}, ${NEW}, ${B.branch}, 'x', 'PENDING', 'x')`),
    ).rejects.toThrow();
    expect(
      await asA(sql`UPDATE devices SET label = 'mine' WHERE id = ${DEVICE_B} RETURNING id`),
    ).toEqual([]);
  });

  it("a device under A cannot point at B's branch — the tenant-qualified FK refuses it", async () => {
    await expect(
      asA(sql`INSERT INTO devices (company_id, id, branch_id, label, status, claim_hash)
              VALUES (${A.company}, ${NEW}, ${B.branch}, 'x', 'PENDING', 'x')`),
    ).rejects.toThrow();
  });

  it('nobody deletes a device — it is revoked and kept', async () => {
    await expect(asA(sql`DELETE FROM devices`)).rejects.toThrow();
  });
});
