import { afterAll, beforeAll, expect, it } from 'vitest';
import { requestDiscountApprovalResponse } from '@pospay/contracts';
import { AT, ids, discountRequestFixture, type DiscountRequestFixture } from './session.fixture.ts';

let f: DiscountRequestFixture;
beforeAll(async () => { f = await discountRequestFixture(); });
afterAll(async () => { await f?.close(); });

async function proposalRow(requestId: string) {
  const [row] = await f.h.owner`SELECT session_id,occurred_at,terms FROM discount_proposals
    WHERE company_id=${f.company} AND request_id=${requestId}`;
  return row as Record<string, unknown> | undefined;
}

async function storedCounts() {
  const [row] = await f.h.owner`SELECT
    (SELECT count(*)::int FROM discount_proposals WHERE company_id=${f.company}) AS proposals,
    (SELECT count(*)::int FROM discount_proposal_performers WHERE company_id=${f.company}) AS performers,
    (SELECT count(*)::int FROM audit_log WHERE company_id=${f.company} AND action='discount_proposal.requested') AS audits,
    (SELECT count(*)::int FROM outbox WHERE company_id=${f.company} AND event_type='DiscountApprovalRequested') AS events`;
  return row as Record<string, number>;
}

it('DP-02 a fresh visit carries no session and the instant the request was made', async () => {
  const body = requestDiscountApprovalResponse.parse(await f.request.execute({
    ...f.context(), input: f.requestBody([f.draft(0, '25.000', '5.000', 1)]),
  }));
  expect(body.occurred_at).toBe('2026-10-15T08:00:00.000Z');
  const row = await proposalRow(body.request_id);
  expect(row?.['session_id']).toBeNull();
  expect((row?.['occurred_at'] as Date).toISOString()).toBe('2026-10-15T08:00:00.000Z');
  expect((row?.['terms'] as { session_id: string | null }).session_id).toBeNull();
});

it('DP-02 an explicit past instant is stored and returned as it was sent', async () => {
  const body = requestDiscountApprovalResponse.parse(await f.request.execute({
    ...f.context(), input: f.requestBody([f.draft(0, '25.000', '5.000', 1)], { occurred_at: '2026-10-14T08:00:00.000Z' }),
  }));
  expect(body.occurred_at).toBe('2026-10-14T08:00:00.000Z');
  const row = await proposalRow(body.request_id);
  expect((row?.['occurred_at'] as Date).toISOString()).toBe('2026-10-14T08:00:00.000Z');
});

it('DP-06 a visit of another branch is refused as if it did not exist', async () => {
  const before = await storedCounts();
  const foreignSession = ids.newId();
  await f.h.owner`INSERT INTO service_sessions(company_id,id,business_id,branch_id,customer_id,customer_name,customer_phone_masked,
    recorded_by,recorded_by_membership_id,occurred_at,recorded_at,business_date,business_timezone,late,created_at)
    VALUES(${f.company},${foreignSession},${f.secondBusiness},${f.secondBranch},${f.customer},'Synthetic customer','***123',
      ${f.userId},${f.membership},'2026-10-14T08:00:00.000Z'::timestamptz,now(),'2026-10-14','Asia/Kuwait',false,now())`;
  await expect(f.request.execute({ ...f.context(), input: f.requestBody([f.draft(0, '25.000', '5.000', 1)], { session_id: foreignSession }) }))
    .rejects.toThrow('FORBIDDEN');
  expect(await storedCounts()).toEqual(before);
});

it('DP-06 an unknown visit and a customer of another visit are refused the same way', async () => {
  const before = await storedCounts();
  const recorded = await f.create.execute({ ...f.context(), input: f.body([f.line()]) });
  const otherCustomer = ids.newId();
  await f.h.owner`INSERT INTO customers(company_id,id,name,phone,locale,created_at,updated_at)
    VALUES(${f.company},${otherCustomer},'Another customer','+999999998124','en',now(),now())`;
  await expect(f.request.execute({ ...f.context(), input: f.requestBody([f.draft(0, '25.000', '5.000', 1)], { session_id: ids.newId() }) }))
    .rejects.toThrow('FORBIDDEN');
  await expect(f.request.execute({ ...f.context(), input: { customer_id: otherCustomer,
    lines: [f.draft(0, '25.000', '5.000', 1)], session_id: recorded.session.id } }))
    .rejects.toThrow('FORBIDDEN');
  expect(await storedCounts()).toEqual(before);
});

it('DP-06 a visit outside the back-dating window is refused and nothing is stored', async () => {
  const before = await storedCounts();
  const recorded = await f.create.execute({ ...f.context(), input: f.body([f.line()]) });
  f.setAt(new Date('2026-12-20T08:00:00.000Z'));
  try {
    await expect(f.request.execute({ ...f.context(), input: f.requestBody([f.draft(0, '25.000', '5.000', 1)], { session_id: recorded.session.id }) }))
      .rejects.toThrow('SESSION_TIME_TOO_OLD');
  } finally {
    f.setAt(AT);
  }
  expect(await storedCounts()).toEqual(before);
});
