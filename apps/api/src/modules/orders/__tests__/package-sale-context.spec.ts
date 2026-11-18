import { afterAll, beforeAll, expect, it } from 'vitest';
import { access, options, place } from '../persistence/package-sale-context.adapter.ts';
import { PackageSaleContextQueryHandler } from '../queries/package-sale-context.query.ts';
import { packageSaleRequestFixture } from './package-sale-request.fixture.ts';
import { ids, must, type SessionFixture } from './session.fixture.ts';

let f: SessionFixture;
let handler: PackageSaleContextQueryHandler;
let setAt: (at: Date) => void;
const scope = () => ({
  companyId: f.company,
  userId: f.userId,
  businessId: f.business,
  branchId: f.branch,
});
const sellerQuery = (occurred_at: string, limit = 20, cursor?: string) => ({
  occurred_at,
  lang: 'en' as const,
  limit,
  ...(cursor === undefined ? {} : { cursor }),
});

beforeAll(async () => {
  const fixture = await packageSaleRequestFixture();
  f = fixture.f;
  setAt = fixture.setAt;
  handler = new PackageSaleContextQueryHandler(f.db, { place, access, options }, f.clock);
});
afterAll(async () => {
  await f?.close();
});

it('returns the server anchor and every sale-eligible recorder without choosing between two', async () => {
  const first = await handler.context(scope());
  expect(first).toMatchObject({
    generated_at: f.clock.now().toISOString(),
    business_timezone: 'Asia/Kuwait',
    recorders: [{ membership_id: f.membership, scope_type: 'BRANCH', scope_id: f.branch }],
  });
  const second = ids.newId();
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    SELECT company_id,${second},user_id,role_id,role_owner_key,scope_type,scope_id,'2026-01-01'
    FROM memberships WHERE company_id=${f.company} AND id=${f.membership}`;
  try {
    const context = await handler.context(scope());
    expect(context.recorders.map((entry) => entry.membership_id)).toEqual(
      [...new Set([f.membership, second])].sort(),
    );
  } finally {
    await f.h.owner`DELETE FROM memberships WHERE company_id=${f.company} AND id=${second}`;
  }
});

it('projects seller choice facts only and keeps cursor pages on one sale anchor', async () => {
  const anchor = f.clock.now().toISOString();
  const first = await handler.sellers(scope(), sellerQuery(anchor, 1));
  expect(first.items[0]).toEqual({
    id: expect.any(String),
    name_ar: null,
    name_en: expect.any(String),
    employee_number: expect.any(Number),
  });
  expect(first.next_cursor).not.toBeNull();
  const second = await handler.sellers(scope(), sellerQuery(anchor, 1, must(first.next_cursor)));
  expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
  expect(JSON.stringify(first)).not.toContain('warning');
});

it('uses the refreshed server date for branch attachment eligibility', async () => {
  const employee = ids.newId();
  await f.h
    .owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES(${f.company},${employee},${f.business},${f.branch},'Synthetic refreshed employee','synthetic refreshed employee','staff','2026-01-01',199)`;
  await f.h
    .owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from","to")
    VALUES
      (${f.company},${ids.newId()},${f.business},${employee},${f.branch},'2026-01-01','2026-10-14'),
      (${f.company},${ids.newId()},${f.business},${employee},${f.branch},'2026-10-16',NULL)`;
  try {
    const before = await handler.sellers(scope(), sellerQuery('2026-10-15T08:00:00.000Z'));
    expect(before.items.some((entry) => entry.id === employee)).toBe(false);
    setAt(new Date('2026-10-16T08:00:00.000Z'));
    const context = await handler.context(scope());
    const after = await handler.sellers(scope(), sellerQuery('2026-10-15T08:00:00.000Z'));
    expect(after.sale_anchor).toBe(context.generated_at);
    expect(after.items.some((entry) => entry.id === employee)).toBe(true);
  } finally {
    setAt(new Date('2026-10-15T08:00:00.000Z'));
  }
});
