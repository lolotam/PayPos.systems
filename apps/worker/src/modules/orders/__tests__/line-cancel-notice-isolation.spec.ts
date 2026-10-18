import { beforeAll, afterAll, expect, it } from 'vitest';
import { USER, TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { lineCancelFixture, type LineCancelFixture } from './line-cancel-notice.fixture.ts';

let f: LineCancelFixture;
beforeAll(async () => {
  f = await lineCancelFixture();
});
afterAll(async () => {
  await f?.close();
});

it('another company cannot touch this line, and only the four roles at this branch are notified, canceller included', async () => {
  const keeper = await f.user();
  await f.member(keeper, 'branch_manager', 'BRANCH', f.tenant.branch);
  await excludeOthers();
  const prepared = await f.cancel();
  const foreign = await f.cancel({ company: TENANT.B.company });
  expect((await f.deliver(prepared.event)).delivered).toBe(true);
  expect((await f.deliver({ ...foreign.event, companyId: TENANT.A.company })).delivered).toBe(
    false,
  );
  expect(recipientIds(await f.requests(prepared.sessionId))).toEqual([USER, keeper].sort());
  expect(await f.notices(prepared.lineId)).toHaveLength(1);
  expect(
    await f.owner`SELECT id FROM service_line_cancel_notices WHERE company_id=${TENANT.A.company} AND line_id=${foreign.lineId}`,
  ).toHaveLength(0);
  expect(
    await f.owner`SELECT id FROM service_line_cancel_notices WHERE company_id=${TENANT.B.company} AND line_id=${foreign.lineId}`,
  ).toHaveLength(0);
});

function recipientIds(rows: Record<string, unknown>[]): string[] {
  return rows
    .flatMap((row) =>
      (
        row['payload'] as { notification_recipients: { user_id: string }[] }
      ).notification_recipients.map((recipient) => recipient.user_id),
    )
    .sort();
}

async function excludeOthers() {
  const otherBusiness = f.ids.newId();
  const otherBranch = f.ids.newId();
  const custom = f.ids.newId();
  const past = new Date(f.at.getTime() - 60_000);
  await f.owner`INSERT INTO businesses(company_id,id,name_en,vertical_type) VALUES(${f.tenant.company},${otherBusiness},'Other salon','salon')`;
  await f.owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES(${f.tenant.company},${otherBranch},${otherBusiness},'Other branch')`;
  await f.owner`INSERT INTO roles(id,company_id,code,name_en) VALUES(${custom},${f.tenant.company},'branch_manager','Custom manager')`;
  await f.member(
    await f.user(),
    'owner',
    'COMPANY',
    f.tenant.company,
    new Date(f.at.getTime() + 1),
  );
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
