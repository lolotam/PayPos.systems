import { afterAll, beforeAll, expect, it } from 'vitest';
import { TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
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

it('another company never receives the bell, and a request of another company is not matched', async () => {
  const scope = await f.otherScope();
  const approver = await f.user();
  await f.member(approver, 'branch_manager', 'BRANCH', scope.branch);
  const foreign = await f.user();
  await f.member(
    foreign,
    'branch_manager',
    'BRANCH',
    TENANT.B.branch,
    undefined,
    null,
    TENANT.B.company,
  );
  const request = await f.request({ scope, lines: 1 });
  expect((await f.deliver(request.event)).delivered).toBe(true);
  expect(recipientIds(await f.requests(request.requestId))).toEqual([approver]);
  const other = await f.request({ scope: await f.otherScope(TENANT.B.company), lines: 1 });
  expect((await f.deliver({ ...other.event, companyId: TENANT.A.company })).delivered).toBe(false);
  expect(await ledger(TENANT.A.company, other.requestId)).toHaveLength(0);
  expect(await ledger(TENANT.B.company, other.requestId)).toHaveLength(0);
});

function recipientIds(rows: Record<string, unknown>[]): string[] {
  return rows.flatMap((row) =>
    (
      row['payload'] as { notification_recipients: { user_id: string }[] }
    ).notification_recipients.map((recipient) => recipient.user_id),
  );
}
function ledger(companyId: string, requestId: string) {
  return f.owner`SELECT id FROM discount_approval_notices WHERE company_id=${companyId} AND request_id=${requestId}`;
}
