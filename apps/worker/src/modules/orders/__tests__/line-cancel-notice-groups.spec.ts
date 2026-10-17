import { beforeAll, afterAll, expect, it } from 'vitest';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { lineCancelFixture, type LineCancelFixture } from './line-cancel-notice.fixture.ts';

let f: LineCancelFixture;
beforeAll(async () => {
  f = await lineCancelFixture();
});
afterAll(async () => {
  await f?.close();
});

it('101 recipients commit two groups of at most 100 with one ledger row', async () => {
  const recipients = [USER];
  for (let index = 0; index < 100; index += 1) {
    const userId = await f.user();
    recipients.push(userId);
    await f.member(userId, 'branch_manager', 'BRANCH', f.tenant.branch);
  }
  const prepared = await f.cancel();
  expect((await f.deliver(prepared.event)).delivered).toBe(true);
  const requests = await f.requests(prepared.sessionId);
  const groups = requests.map(
    (row) =>
      (row['payload'] as { notification_recipients: { user_id: string }[] })
        .notification_recipients,
  );
  expect(groups.map((group) => group.length)).toEqual([100, 1]);
  expect(groups.flat().map((recipient) => recipient.user_id)).toEqual([...recipients].sort());
  expect(await f.notices(prepared.lineId)).toMatchObject([{ recipient_count: 101 }]);
}, 60_000);
