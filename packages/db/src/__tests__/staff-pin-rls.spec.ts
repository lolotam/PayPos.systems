import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';
import { createDatabase, type Database } from '../index.ts';

let test: TestDatabase, db: Database, owner: postgres.Sql, auth: postgres.Sql;
const holder = randomUUID(),
  credential = randomUUID();
beforeAll(async () => {
  test = await createTestDatabase();
  await seedTwoTenants(test.ownerUrl);
  owner = postgres(test.ownerUrl, { max: 1, onnotice: () => undefined });
  auth = postgres(test.authUrl, { max: 1 });
  db = createDatabase({ url: test.appUrl, ids: { newId: randomUUID } });
  await owner`INSERT INTO "user"(id,name,email) VALUES(${holder},'Synthetic','pin-holder@synthetic.invalid')`;
  await owner`INSERT INTO cashier_pins(company_id,id,user_id,pin_hash,set_at)
    VALUES(${TENANT.A.company},${credential},${holder},'pbkdf2-sha256$synthetic',clock_timestamp())`;
});
afterAll(async () => {
  await db?.close();
  await auth?.end();
  await owner?.end();
  await test?.drop();
});

it('user-owned PIN retains FORCE RLS, tenant-qualified uniqueness and auth denial', async () => {
  const rows = (company: string) =>
    db.withTenant(company, (tx) =>
      tx.execute(sql`SELECT id FROM cashier_pins WHERE user_id=${holder}`),
    );
  expect(await rows(TENANT.A.company)).toHaveLength(1);
  expect(await rows(TENANT.B.company)).toHaveLength(0);
  expect(
    await db.withTenant(TENANT.B.company, (tx) =>
      tx.execute(sql`
    UPDATE cashier_pins SET set_at=clock_timestamp() WHERE company_id=${TENANT.A.company} AND id=${credential} RETURNING id`),
    ),
  ).toHaveLength(0);
  await expect(
    db.withTenant(TENANT.B.company, (tx) =>
      tx.execute(sql`
    INSERT INTO cashier_pins(company_id,id,user_id,pin_hash,set_at)
    VALUES(${TENANT.A.company},${randomUUID()},${holder},'pbkdf2-sha256$synthetic',clock_timestamp())`),
    ),
  ).rejects.toThrow();
  await expect(auth`SELECT user_id,pin_hash FROM cashier_pins`).rejects.toThrow(
    /permission denied/,
  );
  const [flags] =
    await owner`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='cashier_pins'`;
  expect(flags).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
});
it('rejects a missing or dual holder and duplicate user PIN within the company', async () => {
  for (const employee of [null, randomUUID()]) {
    await expect(owner`INSERT INTO cashier_pins(company_id,id,user_id,employee_id,pin_hash,set_at)
      VALUES(${TENANT.A.company},${randomUUID()},${employee === null ? null : holder},${employee},
      'pbkdf2-sha256$synthetic',clock_timestamp())`).rejects.toThrow(/cashier_pins_one_holder/);
  }
  await expect(owner`INSERT INTO cashier_pins(company_id,id,user_id,pin_hash,set_at)
    VALUES(${TENANT.A.company},${randomUUID()},${holder},'pbkdf2-sha256$synthetic',clock_timestamp())`).rejects.toThrow(
    /cashier_pins_user/,
  );
});
