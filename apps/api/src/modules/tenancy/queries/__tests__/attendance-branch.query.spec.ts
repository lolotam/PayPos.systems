import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { personalFixture } from '../../../../../test/personal-staff.fixture.ts';
import { attendanceBranch, attendanceBranchStatement } from '../attendance-branch.query.ts';
let f: Awaited<ReturnType<typeof personalFixture>>;
beforeAll(async () => {
  f = await personalFixture();
});
afterAll(async () => {
  await f?.close();
});
it('returns exact active branch ownership/geo/timezone, falls back to business, and hides another tenant', async () => {
  await f.owner`UPDATE businesses SET timezone='Asia/Qatar' WHERE company_id=${f.companyId}`;
  await f.owner`UPDATE branches SET geo_lat=0,geo_lng=0 WHERE company_id=${f.companyId}`;
  expect(
    await f.database.withTenant(f.companyId, (tx) =>
      attendanceBranch(tx, f.companyId, f.businessId, f.branchId),
    ),
  ).toEqual({ timezone: 'Asia/Qatar', lat: 0, lng: 0 });
  await f.owner`UPDATE branches SET timezone='America/New_York' WHERE company_id=${f.companyId}`;
  expect(
    await f.database.withTenant(f.companyId, (tx) =>
      attendanceBranch(tx, f.companyId, f.businessId, f.branchId),
    ),
  ).toEqual({ timezone: 'America/New_York', lat: 0, lng: 0 });
  expect(
    await f.database.withTenant(f.otherCompany, (tx) =>
      attendanceBranch(tx, f.companyId, f.businessId, f.branchId),
    ),
  ).toBeNull();
  expect(
    await f.database.withTenant(f.companyId, (tx) =>
      attendanceBranch(tx, f.companyId, f.ids.newId(), f.branchId),
    ),
  ).toBeNull();
  await f.owner`UPDATE branches SET is_active=false WHERE company_id=${f.companyId}`;
  expect(
    await f.database.withTenant(f.companyId, (tx) =>
      attendanceBranch(tx, f.companyId, f.businessId, f.branchId),
    ),
  ).toBeNull();
});
it('the query uses tenant-qualified branch and business primary keys', async () => {
  await f.database.withTenant(f.companyId, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    const plan = await tx.execute(
      sql`EXPLAIN (ANALYZE,FORMAT JSON) ${attendanceBranchStatement(f.companyId, f.businessId, f.branchId)}`,
    );
    expect(JSON.stringify(plan)).toMatch(/branches_(pkey|company_business_id_key)/);
  });
});
