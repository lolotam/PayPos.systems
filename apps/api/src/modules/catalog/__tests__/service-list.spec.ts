import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { listServices, listServicesStatement } from '../queries/list-services.query.ts';
import { servicesFixture, termsFor, type ServiceFixture } from './services.fixture.ts';

let f: ServiceFixture;
let records: Awaited<ReturnType<ServiceFixture['create']['execute']>>[];

beforeAll(async () => {
  f = await servicesFixture();
  records = [];
  for (const name of ['Alpha', 'Bravo', 'Charlie']) {
    records.push(
      await f.create.execute({
        companyId: f.company,
        userId: f.userId,
        businessId: f.business,
        input: termsFor(name),
      }),
    );
  }
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

const list = (limit: number, cursor?: string, company = f.company, business = f.business) =>
  f.db.withTenant(company, (tx) =>
    listServices(tx, company, business, { limit, ...(cursor ? { cursor } : {}) }),
  );

it('SV-08b lists exact DTO projections with stable cursor pages and no duplicate rows', async () => {
  const first = await list(2);
  expect(first.items).toEqual(
    records.slice(0, 2).map((record) => ({
      id: record.id,
      name_en: record.name_en,
      name_ar: record.name_ar,
      price: record.price,
      commission_rule: record.commission_rule,
      counts_toward_threshold: record.counts_toward_threshold,
      revision: record.revision,
    })),
  );
  expect(first.next_cursor).toBe(records[1]?.id);
  expect(await list(2, first.next_cursor ?? undefined)).toEqual({
    items: [
      {
        id: records[2]?.id,
        name_en: records[2]?.name_en,
        name_ar: records[2]?.name_ar,
        price: records[2]?.price,
        commission_rule: records[2]?.commission_rule,
        counts_toward_threshold: records[2]?.counts_toward_threshold,
        revision: records[2]?.revision,
      },
    ],
    next_cursor: null,
  });
});

it('SV-08c isolates another company and another business', async () => {
  expect(await list(20, undefined, f.otherCompany)).toEqual({ items: [], next_cursor: null });
  expect(await list(20, undefined, f.company, f.secondBusiness)).toEqual({
    items: [],
    next_cursor: null,
  });
});

it('SV-08d the list plan uses the company/business/id cursor index', async () => {
  const plan = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${listServicesStatement(f.company, f.business, { limit: 20 })}`,
    );
  });
  expect(JSON.stringify(plan)).toContain('services_company_business_id');
});
