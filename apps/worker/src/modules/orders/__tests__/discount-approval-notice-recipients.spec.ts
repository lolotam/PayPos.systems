import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  discountApprovalFixture,
  type DiscountApprovalFixture,
} from './discount-approval-notice.fixture.ts';
import type { ApprovalRequester, ApprovalScope } from './discount-approval-notice-data.ts';

let f: DiscountApprovalFixture;
beforeAll(async () => {
  f = await discountApprovalFixture();
});
afterAll(async () => {
  await f?.close();
});

it('the four default roles approve at the branch', async () => {
  const scope = await f.otherCompany();
  const owner = await f.user();
  await f.member(owner, 'owner', 'COMPANY', scope.company, undefined, null, scope.company);
  const general = await f.user();
  await f.member(
    general,
    'general_manager',
    'BRANCH',
    scope.branch,
    undefined,
    null,
    scope.company,
  );
  const business = await f.user();
  await f.member(
    business,
    'business_manager',
    'BRANCH',
    scope.branch,
    undefined,
    null,
    scope.company,
  );
  const branchManager = await f.user();
  await f.member(
    branchManager,
    'branch_manager',
    'BRANCH',
    scope.branch,
    undefined,
    null,
    scope.company,
  );
  const requester = await f.user();
  const requesterMembership = await f.member(
    requester,
    'branch_manager',
    'BRANCH',
    scope.branch,
    undefined,
    null,
    scope.company,
  );
  expect(await approvers(scope, { userId: requester, membershipId: requesterMembership })).toEqual(
    [branchManager, business, general, owner].sort(),
  );
});

it('a cashier granted the permission by name is a recipient', async () => {
  const scope = await f.otherScope();
  const cashier = await f.user();
  const membership = await f.member(cashier, 'cashier', 'BRANCH', scope.branch);
  await f.allow(membership, 'BRANCH', scope.branch, scope.company);
  expect(await approvers(scope)).toEqual([cashier]);
});

it('a branch manager with a DENY at that branch is not a recipient', async () => {
  const scope = await f.otherScope();
  const manager = await f.user();
  const membership = await f.member(manager, 'branch_manager', 'BRANCH', scope.branch);
  await f.deny(membership, 'BRANCH', scope.branch, scope.company);
  await expectNoBell(scope);
});

it('a DENY at another branch does not exclude the holder', async () => {
  const scope = await f.otherScope();
  const other = await f.otherScope();
  const manager = await f.user();
  const membership = await f.member(manager, 'branch_manager', 'BRANCH', scope.branch);
  await f.deny(membership, 'BRANCH', other.branch, scope.company);
  expect(await approvers(scope)).toEqual([manager]);
});

it('a holder only at another branch is not a recipient', async () => {
  const scope = await f.otherScope();
  const other = await f.otherScope();
  const manager = await f.user();
  await f.member(manager, 'branch_manager', 'BRANCH', other.branch);
  await expectNoBell(scope);
});

it('a membership that has not started or has ended is not a recipient', async () => {
  const scope = await f.otherScope();
  const later = await f.user();
  await f.member(
    later,
    'branch_manager',
    'BRANCH',
    scope.branch,
    new Date(f.at.getTime() + 60_000),
  );
  const ended = await f.user();
  await f.member(
    ended,
    'branch_manager',
    'BRANCH',
    scope.branch,
    new Date(f.at.getTime() - 120_000),
    f.at,
  );
  await expectNoBell(scope);
});

it('an expired DENY is ignored', async () => {
  const scope = await f.otherScope();
  const manager = await f.user();
  const membership = await f.member(manager, 'branch_manager', 'BRANCH', scope.branch);
  await f.deny(membership, 'BRANCH', scope.branch, scope.company, new Date(f.at.getTime() - 1000));
  expect(await approvers(scope)).toEqual([manager]);
});

it('an owner ignores a DENY on her own membership', async () => {
  const scope = await f.otherCompany();
  const owner = await f.user();
  const membership = await f.member(
    owner,
    'owner',
    'COMPANY',
    scope.company,
    undefined,
    null,
    scope.company,
  );
  await f.deny(membership, 'BRANCH', scope.branch, scope.company);
  const requester = await f.user();
  const requesterMembership = await f.member(
    requester,
    'branch_manager',
    'BRANCH',
    scope.branch,
    undefined,
    null,
    scope.company,
  );
  expect(await approvers(scope, { userId: requester, membershipId: requesterMembership })).toEqual([
    owner,
  ]);
});

it('the requester never receives the bell even when she holds the permission', async () => {
  const scope = await f.otherScope();
  await expectNoBell(scope);
});

/** يطلب جرساً لطلب جديد ويقرأ مستلميه؛ الطالبة نفسها (مالكة البذرة) تسقط من قائمة الجرس. */
async function approvers(
  scope: ApprovalScope,
  requester?: ApprovalRequester,
): Promise<readonly string[]> {
  const request = await f.request(
    requester === undefined ? { scope, lines: 1 } : { scope, lines: 1, requester },
  );
  expect(await f.deliver(request.event)).toEqual({ delivered: true });
  return bellRecipients(request.requestId);
}

/** لا جرس بلا مستلمين: الدفتر يسجّل صفراً ولا يخرج حدث. */
async function expectNoBell(scope: ApprovalScope, requester?: ApprovalRequester): Promise<void> {
  const request = await f.request(
    requester === undefined ? { scope, lines: 1 } : { scope, lines: 1, requester },
  );
  expect(await f.deliver(request.event)).toEqual({ delivered: true });
  expect(await bellRecipients(request.requestId)).toEqual([]);
  expect(await ledger(request.requestId)).toMatchObject([{ recipient_count: 0 }]);
}

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
