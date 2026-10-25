import { afterAll, beforeAll, expect, it } from 'vitest';
import { SYSTEM_ROLES } from '@pospay/db';
import type { RecordServiceSessionInput } from '@pospay/contracts';
import { AT, discountRequestFixture, ids, must, type DiscountRequestFixture } from './session.fixture.ts';
import {
  approvedProposal, decideProposal, draftLine, OCCURRED_AT, pendingProposal, proposalRow, rejectedProposal, seedEditProposal, seedProposal,
} from './discount-consumption.helpers.ts';

let f: DiscountRequestFixture;
beforeAll(async () => { f = await discountRequestFixture(); });
afterAll(async () => { await f?.close(); });

type LineInput = RecordServiceSessionInput['lines'][number];
const createInput = (lines: LineInput[]): RecordServiceSessionInput =>
  ({ customer_id: f.customer, occurred_at: OCCURRED_AT, lines });
const create = (lines: LineInput[], actor = f.userId) =>
  f.create.execute({ ...f.context(ids.newId(), actor), input: createInput(lines) });

/** refusal الجواب المتوقع: السطر المرفوض يرجع سببه، والخط العادي يُحفظ، والسطر وحده يرفض الطلب كله. */
async function expectRefusal(proposalId: string, expected: string, actor = f.userId, draft = draftLine(f)) {
  const partial = await create([{ ...draft, discount_proposal_id: proposalId }, f.line()], actor);
  expect(partial.outcome).toBe('PARTIAL');
  expect(partial.rejected_lines[0]).toMatchObject({ input_index: 0, approval_refusal: expected, discount_proposal_id: proposalId });
  expect(partial.session.lines).toHaveLength(1);
  await expect(create([{ ...draft, discount_proposal_id: proposalId }], actor)).rejects.toMatchObject({
    code: 'SESSION_DISCOUNT_ABOVE_LIMIT',
    details: { rejected_lines: [{ approval_refusal: expected, discount_proposal_id: proposalId }] },
  });
}

it('DP-23 a pending and a rejected approval refuse the line as not approved', async () => {
  const pending = await pendingProposal(f);
  await expectRefusal(pending, 'NOT_APPROVED');
  const rejected = await rejectedProposal(f);
  await expectRefusal(rejected, 'NOT_APPROVED');
  expect((await proposalRow(f, pending))?.['status']).toBe('PENDING');
  expect((await proposalRow(f, rejected))?.['status']).toBe('REJECTED');
});

it('DP-23 an approval past its expiry refuses the line as expired', async () => {
  const proposalId = await approvedProposal(f);
  f.setAt(new Date('2026-10-16T08:00:00.000Z'));
  try {
    await expectRefusal(proposalId, 'EXPIRED');
  } finally {
    f.setAt(AT);
  }
  expect((await proposalRow(f, proposalId))?.['status']).toBe('APPROVED');
});

it('DP-23 an unknown approval id refuses the line as not found', async () => {
  await expectRefusal(ids.newId(), 'NOT_FOUND');
});

it('DP-23 an approval of another business refuses the line as not found', async () => {
  const serviceId = ids.newId();
  await f.h.owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind,commission_pct_bps,commission_fixed_amount)
    VALUES(${f.company},${serviceId},${f.secondBusiness},'Synthetic other business service','25.000','FOLLOW_PLAN',NULL,NULL)`;
  const proposalId = await seedProposal(f, { businessId: f.secondBusiness, branchId: f.secondBranch, serviceId, serviceName: 'Synthetic other business service' });
  await expectRefusal(proposalId, 'NOT_FOUND');
});

it('DP-23 the editor cannot consume the approval the cashier asked for', async () => {
  const proposalId = await approvedProposal(f);
  await expectRefusal(proposalId, 'NOT_FOUND', f.editorId, f.draft(0, '25.000', '7.500', 1));
});

it('DP-23 an approval of an edit is not found in the recording path', async () => {
  const visit = await f.create.execute({ ...f.context(), input: createInput([f.line()]) });
  const lineId = must(visit.session.lines[0]).id;
  const proposalId = await seedEditProposal(f, lineId, visit.session.id);
  await expectRefusal(proposalId, 'NOT_FOUND');
});

it('D-21 an approval of another branch refuses the line as not found and stays approved', async () => {
  const role = must(SYSTEM_ROLES.find((item) => item.code === 'cashier')).id;
  await f.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps,starts_at)
    VALUES(${f.company},${ids.newId()},${f.userId},${role},'global','BRANCH',${f.otherBranch},1000,'2026-01-01T00:00:00Z')`;
  const body = await f.request.execute({
    ...f.context(ids.newId()), branchId: f.otherBranch,
    input: f.requestBody([draftLine(f)], { occurred_at: OCCURRED_AT }),
  });
  const proposalId = must(body.proposals[0]).id;
  await decideProposal(f, proposalId, 'APPROVED');
  await expectRefusal(proposalId, 'NOT_FOUND');
  const row = await proposalRow(f, proposalId);
  expect(row?.['status']).toBe('APPROVED');
  expect(row?.['consumed_line_id']).toBeNull();
});
