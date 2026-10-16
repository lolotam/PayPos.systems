import { beforeAll, afterAll, expect, it } from 'vitest';
import { USER, TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { priceEditFixture, type PriceEditFixture } from './price-edit-notice.fixture.ts';

let f: PriceEditFixture;
beforeAll(async () => {
  f = await priceEditFixture();
});
afterAll(async () => {
  await f?.close();
});

it('test 5: another tenant, another branch, another business, a non-manager, a custom role, an inactive membership and a removed membership do not receive the bell', async () => {
  const keeper = await f.user();
  await f.member(keeper, 'branch_manager', 'BRANCH', f.tenant.branch);
  await excludeOthers();
  const prepared = await f.edit();
  expect((await f.deliver(prepared.event)).delivered).toBe(true);
  expect(recipientIds(await f.requests(prepared.sessionId))).toEqual([USER, keeper].sort());
});

function recipientIds(rows: Record<string, unknown>[]): string[] {
  return rows.flatMap((row) =>
    (
      row['payload'] as { notification_recipients: { user_id: string }[] }
    ).notification_recipients.map((recipient) => recipient.user_id),
  );
}

async function excludeOthers() {
  const otherBusiness = f.ids.newId();
  const otherBranch = f.ids.newId();
  const custom = f.ids.newId();
  const past = new Date(f.at.getTime() - 60_000);
  await f.owner`INSERT INTO businesses(company_id,id,name_en,vertical_type) VALUES(${f.tenant.company},${otherBusiness},'Other salon','salon')`;
  await f.owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES(${f.tenant.company},${otherBranch},${otherBusiness},'Other branch')`;
  await f.owner`INSERT INTO roles(id,company_id,code,name_en) VALUES(${custom},${f.tenant.company},'branch_manager','Custom manager')`;
  await f.member(await f.user(), 'owner', 'COMPANY', f.tenant.company, new Date(f.at.getTime() + 1));
  await f.member(await f.user(), 'owner', 'COMPANY', f.tenant.company, past, f.at);
  await f.member(await f.user(), 'business_manager', 'BUSINESS', otherBusiness);
  await f.member(await f.user(), 'branch_manager', 'BRANCH', otherBranch);
  await f.member(await f.user(), 'cashier');
  await f.member(await f.user(), custom);
  const removed = await f.member(await f.user(), 'branch_manager', 'BRANCH', f.tenant.branch);
  await f.owner`DELETE FROM memberships WHERE company_id=${f.tenant.company} AND id=${removed}`;
  await f.member(
    await f.user(),
    'branch_manager',
    'BRANCH',
    TENANT.B.branch,
    past,
    null,
    TENANT.B.company,
  );
}
