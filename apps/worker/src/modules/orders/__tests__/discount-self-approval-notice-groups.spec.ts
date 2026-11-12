import { afterAll, beforeAll, expect, it } from 'vitest';
import { discountSelfApprovalRecipients } from '../persistence/discount-self-approval-recipients.adapter.ts';
import type { ApprovalRequester, ApprovalScope } from './discount-approval-notice-data.ts';
import {
  discountSelfApprovalFixture,
  type DiscountSelfApprovalFixture,
} from './discount-self-approval-notice.fixture.ts';

let f: DiscountSelfApprovalFixture;
beforeAll(async () => {
  f = await discountSelfApprovalFixture();
});
afterAll(async () => {
  await f?.close();
});

it('101 owners commit two bell groups of at most 100 with one deduped ledger count', async () => {
  const scope = await f.otherCompany();
  const approver = await companyMember(scope);
  const owners: ApprovalRequester[] = [approver];
  for (let index = 1; index < 101; index += 1) {
    owners.push(await companyMember(scope));
  }
  const prepared = await f.selfApproval({ scope, decidedBy: approver });
  expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
  const groups = (await f.bells(prepared.event.id)).map(recipientIds);
  expect(groups.map((group) => group.length)).toEqual([100, 1]);
  expect(groups.flat()).toEqual(owners.map((owner) => owner.userId).sort());
  expect(await f.notices(prepared.event.id)).toMatchObject([{ recipient_count: 101 }]);
}, 60_000);

it('company and branch owner memberships for one user produce one recipient', async () => {
  const scope = await f.otherCompany();
  const userId = await f.user();
  const membershipId = await f.member(
    userId,
    'owner',
    'COMPANY',
    scope.company,
    undefined,
    null,
    scope.company,
  );
  await f.member(userId, 'owner', 'BRANCH', scope.branch, undefined, null, scope.company);
  const prepared = await f.selfApproval({ scope, decidedBy: { userId, membershipId } });
  const event = f.noticeEvent(prepared);
  // القراءة نفسها قبل التجميع: الـ UNION بين نطاقي الشركة والفرع هو اللي يمنع تكرار المستخدم، مش دالة المجموعات.
  const read = await f.db.withTenant(event.companyId, (tx) =>
    discountSelfApprovalRecipients(tx).roleRecipients(event, f.at, ['owner']),
  );
  expect(read).toEqual([userId]);
  expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
  const groups = (await f.bells(prepared.event.id)).map(recipientIds);
  expect(groups).toEqual([[userId]]);
  expect(await f.notices(prepared.event.id)).toMatchObject([{ recipient_count: 1 }]);
});

async function companyMember(scope: ApprovalScope): Promise<ApprovalRequester> {
  const userId = await f.user();
  const membershipId = await f.member(
    userId,
    'owner',
    'COMPANY',
    scope.company,
    undefined,
    null,
    scope.company,
  );
  return { userId, membershipId };
}

function recipientIds(row: Record<string, unknown>): string[] {
  const payload = row['payload'] as {
    notification_recipients: { user_id: string }[];
  };
  return payload.notification_recipients.map((recipient) => recipient.user_id);
}
