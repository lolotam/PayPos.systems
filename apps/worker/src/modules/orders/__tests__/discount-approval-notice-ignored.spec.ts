import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  discountApprovalFixture,
  type DiscountApprovalFixture,
} from './discount-approval-notice.fixture.ts';
import type { PreparedRequest } from './discount-approval-notice-data.ts';

let f: DiscountApprovalFixture;
beforeAll(async () => {
  f = await discountApprovalFixture();
});
afterAll(async () => {
  await f?.close();
});

it('a wrong aggregate type or id is refused and writes nothing', async () => {
  await expectInvalid(await f.request({ aggregate: 'wrongType' }));
  await expectInvalid(await f.request({ aggregate: 'wrongId' }));
});

it('a payload that does not match the contract is refused and writes nothing', async () => {
  await expectInvalid(await f.request({ malformed: true }));
});

it('a proposals count that differs from the announced lines is refused', async () => {
  await expectInvalid(await f.request({ lines: 2, storedLines: 1 }));
});

it('an announced percent that differs from the stored one is refused', async () => {
  await expectInvalid(await f.request({ lines: 1, announcedBps: 5000, storedBps: 2000 }));
});

it('another event type is ignored', async () => {
  const prepared = await f.request({ lines: 1 });
  await f.consume({ ...prepared.event, eventType: 'ServiceSessionRecorded' });
  expect(await f.notices(prepared.requestId)).toHaveLength(0);
  expect(await f.requests(prepared.requestId)).toHaveLength(0);
});

async function expectInvalid(prepared: PreparedRequest) {
  expect((await f.deliver(prepared.event)).delivered).toBe(false);
  await expect(f.consume(prepared.event)).rejects.toThrow('DISCOUNT_APPROVAL_EVENT_INVALID');
  expect(await f.notices(prepared.requestId)).toHaveLength(0);
  expect(await f.requests(prepared.requestId)).toHaveLength(0);
  expect(await f.consumed(prepared.event.id)).toHaveLength(0);
}
