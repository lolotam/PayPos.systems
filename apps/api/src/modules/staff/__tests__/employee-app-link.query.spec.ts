import { employeeAppLink } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { employeeAppLinkNames } from '../persistence/employee-app-link-names.adapter.ts';
import { readEmployeeAppLink } from '../queries/employee-app-link.query.ts';
import { employeesFixture, type EmployeeFixture } from './employees.fixture.ts';

const unknownBusiness = systemUuidV7().newId();
const plans: string[] = [];
let f: EmployeeFixture;

beforeAll(async () => {
  f = await employeesFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

function explaining(tx: Tx): Tx {
  return new Proxy(tx, {
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
}

it('returns the contract shape and hides foreign or unknown businesses', async () => {
  const result = await f.db.withTenant(
    f.company,
    (tx) => readEmployeeAppLink(employeeAppLinkNames(tx), f.company, f.business),
    { userId: f.userId },
  );
  expect(employeeAppLink.parse(result)).toEqual({
    company_id: f.company,
    business_id: f.business,
    business_name_en: 'Synthetic business',
    business_name_ar: null,
  });
  for (const businessId of [f.foreignBusiness, unknownBusiness]) {
    expect(
      await f.db.withTenant(
        f.company,
        (tx) => readEmployeeAppLink(employeeAppLinkNames(tx), f.company, businessId),
        { userId: f.userId },
      ),
    ).toBeNull();
  }
});

it('EXPLAIN ANALYZE uses the business primary key without a sequential scan', async () => {
  plans.length = 0;
  await f.db.withTenant(
    f.company,
    async (tx) => {
      await tx.execute(sql`SET LOCAL enable_seqscan=off`);
      return readEmployeeAppLink(employeeAppLinkNames(explaining(tx)), f.company, f.business);
    },
    { userId: f.userId },
  );
  const plan = plans.at(-1) ?? '';
  expect(plan).toContain('businesses_pkey');
  expect(plan).not.toContain('Seq Scan');
});
