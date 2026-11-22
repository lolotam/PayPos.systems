import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { readCommissionServiceNames } from '../persistence/commission-service-names.reader.ts';
import { servicesFixture, type ServiceFixture } from './services.fixture.ts';

const ids = systemUuidV7();
let f: ServiceFixture;

beforeAll(async () => {
  f = await servicesFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

/** خدمة في النشاط، بالاسم اللي بيتقارن بيها. */
const insertService = async (businessId: string, nameEn: string): Promise<string> => {
  const id = ids.newId();
  await f.h.owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
    VALUES (${f.company},${id},${businessId},${nameEn},1.000,'ZERO')`;
  return id;
};

it('reads the names of every requested service in one call', async () => {
  const ids_ = await Promise.all([
    insertService(f.business, 'First service'),
    insertService(f.business, 'Second service'),
  ]);
  const names = await f.db.withTenant(f.company, (tx) =>
    readCommissionServiceNames(tx, f.company, f.business, ids_),
  );

  expect(names.get(ids_[0] ?? '')).toEqual({ nameEn: 'First service', nameAr: null });
  expect(names.get(ids_[1] ?? '')).toEqual({ nameEn: 'Second service', nameAr: null });
});

it('reads names across batches for a month with more services than one batch', async () => {
  const serviceIds: string[] = [];
  for (let index = 0; index < 250; index += 1) {
    serviceIds.push(await insertService(f.business, `Service ${index}`));
  }

  const names = await f.db.withTenant(f.company, (tx) =>
    readCommissionServiceNames(tx, f.company, f.business, serviceIds),
  );

  expect(names.size).toBe(250);
  expect(names.get(serviceIds[0] ?? '')).toMatchObject({ nameEn: 'Service 0' });
  expect(names.get(serviceIds[249] ?? '')).toMatchObject({ nameEn: 'Service 249' });
});

it('never returns a service of another business or another company', async () => {
  const other = ids.newId();
  await f.h.owner`INSERT INTO businesses(company_id,id,vertical_type,name_en)
    VALUES (${f.company},${other},'salon','Other catalog business')`;
  const foreign = await insertService(other, 'Foreign service');

  const names = await f.db.withTenant(f.company, (tx) =>
    readCommissionServiceNames(tx, f.company, f.business, [foreign]),
  );

  expect(names.has(foreign)).toBe(false);
});
