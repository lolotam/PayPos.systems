import { performance } from 'node:perf_hooks';
import { sellPackageInput, packageSaleChanged } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  bindPackageSaleReaders,
  createPackageSaleTransactions,
} from '../persistence/package-sale-transactions.ts';
import { SellPackageUseCase } from '../use-cases/sell-package/sell-package.usecase.ts';
import { ids, interceptDatabase } from './session.fixture.ts';
import { packageSaleFixture, type PackageSaleFixture } from './package-sale.fixture.ts';

let f: PackageSaleFixture;
const services = Array.from({ length: 20 }, () => ids.newId());

beforeAll(async () => {
  f = await packageSaleFixture();
  await f.h
    .owner`DELETE FROM package_type_components WHERE company_id=${f.company} AND package_type_id=${f.packageType}`;
  for (const [index, service] of services.entries()) {
    await f.h
      .owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
      VALUES(${f.company},${service},${f.business},${`Synthetic volume service ${index}`},'1.000','ZERO')`;
    await f.h
      .owner`INSERT INTO package_type_components(company_id,id,package_type_id,business_id,service_id,sessions,position)
      VALUES(${f.company},${ids.newId()},${f.packageType},${f.business},${service},365,${index + 1})`;
  }
});

afterAll(async () => {
  await f?.close();
});

it('SA-10 commits 7,300 slots in three financial inserts, each of five warm full sales below 200 ms', async () => {
  const statements: string[] = [];
  const database = interceptDatabase(f.db, async (statement) => {
    statements.push(statement);
  });
  const useCase = new SellPackageUseCase(
    createPackageSaleTransactions(database, ids, bindPackageSaleReaders),
    ids,
    f.clock,
  );
  const input = sellPackageInput.parse({
    ...f.saleInput(),
    expected_service_revisions: services.map((service_id) => ({ service_id, revision: 1 })),
  });
  const durations: number[] = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    statements.length = 0;
    const context = f.context();
    const started = performance.now();
    const response = await useCase.execute(context, input);
    const elapsed = performance.now() - started;
    if (attempt > 0) durations.push(elapsed);
    for (const table of ['package_entitlements', 'package_components', 'package_session_slots']) {
      expect(
        statements.filter((statement) =>
          new RegExp(`INSERT INTO ${table}\\b`, 'i').test(statement),
        ),
      ).toHaveLength(1);
    }
    const saleId = response.entitlement.id;
    const [stored] = await f.h.owner`SELECT count(*)::int AS count, sum(unit_value)::text AS amount
      FROM package_session_slots WHERE company_id=${f.company} AND entitlement_id=${saleId}`;
    expect(stored).toEqual({ count: 7300, amount: '30.000' });
    expect(response.entitlement.components).toHaveLength(20);
    const [event] = await f.h
      .owner`SELECT payload FROM outbox WHERE company_id=${f.company} AND aggregate_id=${saleId}`;
    expect(packageSaleChanged.parse(event?.['payload'])).toMatchObject({
      sale_id: saleId,
      price_paid: '30.000',
      revision: 1,
    });
    const [saved] = await f.h.owner`SELECT response_status,response_body FROM idempotency_keys
      WHERE company_id=${f.company} AND operation='sell-package' AND key=${context.key}`;
    expect(saved).toMatchObject({ response_status: 201, response_body: response });
  }
  console.info('SA-10 full transaction milliseconds (COMMIT included):', JSON.stringify(durations));
  expect(durations).toHaveLength(5);
  for (const elapsed of durations) expect(elapsed, JSON.stringify(durations)).toBeLessThan(200);
});
