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

it('a cashier on the branch with an ALLOW override on its business gets the bell', async () => {
  const scope = await f.otherScope();
  const cashier = await f.user();
  const membership = await f.member(cashier, 'cashier', 'BRANCH', scope.branch);
  await f.allow(membership, 'BUSINESS', scope.business, scope.company);
  const request = await f.request({ scope, lines: 1 });
  expect(await f.deliver(request.event)).toEqual({ delivered: true });
  expect(await bellRecipients(request.requestId)).toEqual([cashier]);
  expect(await ledger(request.requestId)).toMatchObject([{ recipient_count: 1 }]);
});

async function bellRecipients(requestId: string): Promise<string[]> {
  const rows = await f.owner`SELECT payload FROM outbox
    WHERE event_type='DiscountApprovalNoticeRequested' AND payload->>'request_id'=${requestId} ORDER BY seq`;
  return rows
    .flatMap(
      (row) =>
        (row['payload'] as { notification_recipients: { user_id: string }[] })
          .notification_recipients,
    )
    .map((recipient) => recipient.user_id)
    .sort();
}

function ledger(requestId: string) {
  return f.owner`SELECT recipient_count FROM discount_approval_notices
    WHERE request_id=${requestId} ORDER BY id`;
}
