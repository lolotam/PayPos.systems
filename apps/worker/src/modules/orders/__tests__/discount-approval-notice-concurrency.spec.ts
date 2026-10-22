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

it('two concurrent deliveries for the same request ring once', async () => {
  const scope = await f.otherScope();
  const approver = await f.user();
  await f.member(approver, 'branch_manager', 'BRANCH', scope.branch);
  const request = await f.request({ scope, lines: 1 });
  const second = await f.again(request);
  const outcomes = await Promise.all([f.deliver(request.event), f.deliver(second)]);
  expect(outcomes.map((outcome) => outcome.delivered)).toEqual([true, true]);
  expect(await f.notices(request.requestId)).toHaveLength(1);
  expect(await f.requests(request.requestId)).toHaveLength(1);
}, 60_000);
