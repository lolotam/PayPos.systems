import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { packageSalePlace, packageSalePlaceStatement } from '../queries/package-sale-place.query.ts';
import { ids, sessionFixture, type SessionFixture } from '../../../../test/service-session.fixture.ts';

let f: SessionFixture;
const branchWithZone = ids.newId();

beforeAll(async () => {
  f = await sessionFixture();
  await f.h.owner`INSERT INTO branches(company_id,id,business_id,name_en,timezone)
    VALUES(${f.company},${branchWithZone},${f.business},'Synthetic zoned branch','Asia/Tokyo')`;
});
afterAll(async () => {
  await f?.close();
});

const read = (branchId: string, businessId = f.business, companyId = f.company) =>
  f.db.withTenant(companyId, (tx) => packageSalePlace(tx, companyId, businessId, branchId));

it('falls back to the business timezone when the branch has none', async () => {
  expect(await read(f.branch)).toBe('Asia/Kuwait');
});

it('prefers the branch timezone over the business one', async () => {
  expect(await read(branchWithZone)).toBe('Asia/Tokyo');
});

it('returns null for a branch of another business, of another company and for an unknown id', async () => {
  expect(await read(f.secondBranch)).toBeNull();
  expect(await read(f.foreignBranch)).toBeNull();
  expect(await read(f.branch, f.secondBusiness)).toBeNull();
  expect(await read(ids.newId())).toBeNull();
});

it('returns null for an inactive branch', async () => {
  await f.h.owner`UPDATE branches SET is_active=false WHERE company_id=${f.company} AND id=${branchWithZone}`;
  expect(await read(branchWithZone)).toBeNull();
  await f.h.owner`UPDATE branches SET is_active=true WHERE company_id=${f.company} AND id=${branchWithZone}`;
});

it('reads the sale place as an index scan', async () => {
  await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    const plan = await tx.execute(
      sql`EXPLAIN (ANALYZE,FORMAT JSON) ${packageSalePlaceStatement(f.company, f.business, f.branch)}`,
    );
    expect(JSON.stringify(plan)).toMatch(/Index (Only )?Scan|Bitmap Index Scan/);
  });
});
