import { afterAll, beforeAll, expect, it } from 'vitest';
import type { ClaimedEvent } from '@pospay/db';
import { TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { createDiscountSelfApprovalNoticeConsumer } from '../index.ts';
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

it.each([
  ['a different service id', { mismatch: ['service'] as const }],
  ['a different percent', { announcedBps: 2600, storedBps: 2500 }],
  ['a different decider', { mismatch: ['decider'] as const }],
  ['a different decision channel', { mismatch: ['via'] as const }],
  ['a different branch', { mismatch: ['branch'] as const }],
  [
    'an announced proposal the tenant never stored',
    { mismatch: ['count'] as const, proposals: 2, storedProposals: 1 },
  ],
] as const)('rejects an event announcing %s before any claim', async (_label, spec) => {
  const scope = await f.otherScope();
  const prepared = await f.decision({ scope, ...spec });
  await expectInvalid(prepared);
});

it('rejects a stored proposal that is not flagged approver_is_performer', async () => {
  const scope = await f.otherScope();
  const prepared = await f.decision({ scope, performer: false });
  await expectInvalid(prepared);
});

it('rejects a stored proposal that is still pending', async () => {
  const scope = await f.otherScope();
  const prepared = await f.decision({ scope, approve: false });
  await expectInvalid(prepared);
});

it('rejects an event delivered to the wrong tenant envelope', async () => {
  const scope = await f.otherScope();
  const prepared = await f.decision({ scope });
  const foreign = createDiscountSelfApprovalNoticeConsumer(f.ids, { now: () => f.at });
  const wrongTenant = { ...prepared.event, companyId: TENANT.B.company };
  await expect(
    f.db.withTenant(TENANT.B.company, (tx) => foreign.handle(tx, wrongTenant)),
  ).rejects.toThrow('DISCOUNT_SELF_APPROVAL_EVENT_INVALID');
  expect(await f.notices(prepared.companyId, prepared.event.id)).toHaveLength(0);
  expect(await outboundFor(prepared)).toHaveLength(0);
});

it('accepts a source event no matter its aggregate convention', async () => {
  const scope = await f.otherScope();
  const prepared = await f.decision({ scope, aggregate: 'anything_at_all' });
  expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
  expect(await f.notices(prepared.companyId, prepared.event.id)).toMatchObject([
    { recipient_count: 1 },
  ]);
});

/** لا دفتر ولا أوتبوكس للحدث/النشاط المعنيين: التزيين السابق في الشركة لا يُحسب على هذا الاختبار. */
async function expectInvalid(prepared: {
  event: ClaimedEvent;
  companyId: string;
  businessId: string;
}) {
  await expect(f.consume(prepared.event)).rejects.toThrow('DISCOUNT_SELF_APPROVAL_EVENT_INVALID');
  expect(await f.notices(prepared.companyId, prepared.event.id)).toHaveLength(0);
  expect(await outboundFor(prepared)).toHaveLength(0);
}

function outboundFor(prepared: { companyId: string; businessId: string }) {
  return f.owner`SELECT id FROM outbox WHERE company_id=${prepared.companyId}
    AND event_type='DiscountSelfApprovalNoticeRequested' AND payload->>'business_id'=${prepared.businessId}`;
}
