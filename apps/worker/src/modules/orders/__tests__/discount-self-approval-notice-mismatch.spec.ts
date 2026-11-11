import { afterAll, beforeAll, expect, it } from 'vitest';
import { TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import type {
  PreparedSelfApproval,
  SelfApprovalSpec,
} from './discount-self-approval-notice-data.ts';
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

const cases: readonly [string, () => Promise<PreparedSelfApproval>][] = [
  ['an unknown proposal id', () => mismatch({ unknownId: true })],
  ['a proposal from another company', foreignCompany],
  ['another branch', () => mismatch({ eventBranch: f.ids.newId() })],
  ['another business', () => mismatch({ eventBusiness: f.ids.newId() })],
  ['a different service', () => mismatch({ eventService: f.ids.newId() })],
  ['a different percentage', () => mismatch({ eventBps: 3000 })],
  ['a different decider', () => mismatch({ eventDecidedBy: f.ids.newId() })],
  ['a different decision channel', () => mismatch({ eventVia: 'PIN' })],
  ['a false performer flag', () => mismatch({ proposals: [{ performer: false }] })],
  ['a pending proposal', () => mismatch({ proposals: [{ status: 'PENDING' }] })],
  ['a rejected proposal', () => mismatch({ proposals: [{ status: 'REJECTED' }] })],
  ['one more event proposal than stored', () => mismatch({ extraEventProposal: true })],
];

it.each(cases)('rejects %s and rolls back every consumer effect', async (_name, prepare) => {
  const prepared = await prepare();
  await expect(f.consume(prepared.event)).rejects.toThrow('DISCOUNT_SELF_APPROVAL_EVENT_INVALID');
  expect(await f.notices(prepared.event.id)).toHaveLength(0);
  expect(await f.bells(prepared.event.id)).toHaveLength(0);
  expect(await f.consumed(prepared.event.id)).toHaveLength(0);
});

async function mismatch(spec: SelfApprovalSpec): Promise<PreparedSelfApproval> {
  const scope = await f.otherScope();
  return f.selfApproval({ ...spec, scope });
}

async function foreignCompany(): Promise<PreparedSelfApproval> {
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
  const prepared = await f.selfApproval({ scope, decidedBy: { userId, membershipId } });
  return { ...prepared, event: { ...prepared.event, companyId: TENANT.A.company } };
}
