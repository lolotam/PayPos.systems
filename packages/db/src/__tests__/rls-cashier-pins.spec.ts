import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database } from '../index.ts';

// T9b-3: cashier_pins is tenant data (ADR-0003 §4.2) — a device of one company never sees another company's hashes.
const { A, B } = TENANT;
const PIN_B = '01920000-0000-7000-8000-0000000000e7';
const EMPLOYEE_B = '01920000-0000-7000-8000-0000000000e8';
const NEW = '01920000-0000-7000-8000-0000000000e9';
const HASH = 'pbkdf2-sha256$1$x$y';

let testDb: TestDatabase;
let db: Database;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  const owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await owner`INSERT INTO cashier_pins (company_id, id, employee_id, pin_hash, set_at)
                VALUES (${B.company}, ${PIN_B}, ${EMPLOYEE_B}, ${HASH}, now())`;
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

describe('cashier_pins under RLS', () => {
  it("company A reads none of B's PIN hashes, even by employee", async () => {
    expect(await asA(sql`SELECT id FROM cashier_pins`)).toEqual([]);
    expect(await asA(sql`SELECT id FROM cashier_pins WHERE employee_id = ${EMPLOYEE_B}`)).toEqual(
      [],
    );
  });

  it("A cannot insert a PIN for B, nor replace B's", async () => {
    await expect(
      asA(sql`INSERT INTO cashier_pins (company_id, id, employee_id, pin_hash, set_at)
              VALUES (${B.company}, ${NEW}, ${EMPLOYEE_B}, ${HASH}, now())`),
    ).rejects.toThrow();
    expect(
      await asA(sql`UPDATE cashier_pins SET pin_hash = ${HASH} WHERE id = ${PIN_B} RETURNING id`),
    ).toEqual([]);
  });

  it('only a PBKDF2 hash is accepted, never a bare PIN', async () => {
    await expect(
      asA(sql`INSERT INTO cashier_pins (company_id, id, employee_id, pin_hash, set_at)
              VALUES (${A.company}, ${NEW}, ${EMPLOYEE_B}, '4821', now())`),
    ).rejects.toThrow();
  });

  it('nobody deletes a PIN — it is replaced', async () => {
    await expect(asA(sql`DELETE FROM cashier_pins`)).rejects.toThrow();
  });
});
