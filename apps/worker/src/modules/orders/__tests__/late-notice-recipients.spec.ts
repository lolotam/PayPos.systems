import { beforeAll, afterAll, expect, it } from 'vitest';
import { USER, TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { lateNoticeFixture, type LateNoticeFixture } from './late-notice.fixture.ts';
let f: LateNoticeFixture;
beforeAll(async () => {
  f = await lateNoticeFixture();
});
afterAll(async () => {
  await f?.close();
});

it('active system roles at COMPANY/BUSINESS/BRANCH scopes only, duplicates/recorder retained', async () => {
  const eligible: string[] = [USER];
  for (const [role, scope, id] of [
    ['general_manager', 'COMPANY', f.tenant.company],
    ['business_manager', 'BUSINESS', f.tenant.business],
    ['branch_manager', 'BRANCH', f.tenant.branch],
  ] as const) {
    const user = await f.user();
    eligible.push(user);
    await f.member(user, role, scope, id);
  }
  await f.member(USER, 'branch_manager', 'BRANCH', f.tenant.branch);
  await addExcludedMemberships();
  const session = await f.session();
  await f.deliver(await f.event(session));
  const recipients = (await f.requests(session)).flatMap((r) =>
    (
      r['payload'] as { notification_recipients: { user_id: string }[] }
    ).notification_recipients.map((p) => p.user_id),
  );
  expect(recipients).toEqual(eligible.sort());
  const later = await f.user();
  await f.member(later, 'owner');
  await f.deliver(await f.event(session, true, 'ServiceSessionLinesAdded'));
  expect(await f.requests(session)).toHaveLength(1);
});
it.each([100, 101, 201])(
  '%s active users receive complete groups, safely named, exactly once',
  async (count) => {
    await f.owner`UPDATE memberships SET starts_at='2000-01-01', ends_at=${f.at} WHERE company_id=${f.tenant.company} AND user_id<>${USER}`;
    const recipients: string[] = [USER];
    for (let i = 0; i < count - 1; i++) {
      const user = await f.user();
      recipients.push(user);
      await f.member(user, 'branch_manager', 'BRANCH', f.tenant.branch);
    }
    await f.owner`UPDATE branches SET name_en='٩٩٩ ٩٩٩ ٩٩٨ ١٢٣', name_ar='https://example.test' WHERE company_id=${f.tenant.company} AND id=${f.tenant.branch}`;
    const session = await f.session();
    expect((await f.deliver(await f.event(session))).delivered).toBe(true);
    const requests = await f.requests(session);
    expect(requests).toHaveLength(Math.ceil(count / 100));
    const all = requests.flatMap(
      (r) =>
        (
          r['payload'] as {
            notification_recipients: { user_id: string; safe_parameters: { value: string }[] }[];
          }
        ).notification_recipients,
    );
    expect(all.map((r) => r.user_id)).toEqual(recipients.sort());
    expect(all[0]?.safe_parameters.slice(0, 2).map((p) => p.value)).toEqual(['فرع', 'Branch']);
    expect(await f.notices(session)).toMatchObject([{ recipient_count: count }]);
  },
  30_000,
);

async function addExcludedMemberships() {
  const otherBusiness = f.ids.newId(),
    otherBranch = f.ids.newId(),
    custom = f.ids.newId();
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
  await f.member(
    await f.user(),
    'owner',
    'COMPANY',
    f.tenant.company,
    new Date(f.at.getTime() - 1000),
    f.at,
  );
  await f.member(await f.user(), 'business_manager', 'BUSINESS', otherBusiness);
  await f.member(await f.user(), 'branch_manager', 'BRANCH', otherBranch);
  await f.member(await f.user(), 'cashier');
  await f.member(await f.user(), custom);
  const removed = await f.member(await f.user(), 'branch_manager');
  await f.owner`DELETE FROM memberships WHERE company_id=${f.tenant.company} AND id=${removed}`;
  await f.member(
    await f.user(),
    'owner',
    'COMPANY',
    TENANT.B.company,
    undefined,
    null,
    TENANT.B.company,
  );
}
