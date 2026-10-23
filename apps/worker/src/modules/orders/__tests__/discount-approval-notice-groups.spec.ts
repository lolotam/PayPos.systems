import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  discountApprovalFixture,
  type DiscountApprovalFixture,
} from './discount-approval-notice.fixture.ts';

let f: DiscountApprovalFixture;
beforeAll(async () => {
  f = await discountApprovalFixture();
});
afterAll(async () => {
  await f?.close();
});

it('101 recipients commit two groups of at most 100 with one ledger row', async () => {
  const scope = await f.otherScope();
  const recipients: string[] = [];
  for (let index = 0; index < 101; index += 1) {
    const userId = await f.user();
    recipients.push(userId);
    await f.member(userId, 'branch_manager', 'BRANCH', scope.branch);
  }
  const request = await f.request({ scope, lines: 1 });
  expect((await f.deliver(request.event)).delivered).toBe(true);
  const requests = await f.requests(request.requestId);
  const groups = requests.map(
    (row) =>
      (row['payload'] as { notification_recipients: { user_id: string }[] })
        .notification_recipients,
  );
  expect(groups.map((group) => group.length)).toEqual([100, 1]);
  expect(groups.flat().map((recipient) => recipient.user_id)).toEqual([...recipients].sort());
  expect(await f.notices(request.requestId)).toMatchObject([{ recipient_count: 101 }]);
}, 60_000);
