import { afterAll, beforeAll, expect, it } from 'vitest';
import { requestDiscountApprovalResponse } from '@pospay/contracts';
import { AT, ids, must, discountRequestFixture, type DiscountRequestFixture } from './session.fixture.ts';

let f: DiscountRequestFixture;
beforeAll(async () => { f = await discountRequestFixture(); });
afterAll(async () => { await f?.close(); });

const scope = (userId: string) => ({ companyId: f.company, userId, businessId: f.business, branchId: f.branch });

async function ask(lines = 5) {
  const body = requestDiscountApprovalResponse.parse(await f.request.execute({
    ...f.context(), input: f.requestBody(Array.from({ length: lines }, () => f.draft(0, '25.000', '5.000', 1))),
  }));
  return body;
}

async function decide(id: string, decision: 'APPROVED' | 'REJECTED') {
  if (decision === 'APPROVED') {
    await f.h.owner`UPDATE discount_proposals SET status='APPROVED',decided_by=${f.editorId},
      decided_by_membership_id=${f.editorMembership},decided_via='REMOTE',decided_at='2026-10-15T09:00:00.000Z'::timestamptz,
      decider_name_ar='ليلى',decider_name_en='Layla Editor',decider_role='branch_manager',decider_role_is_system=true,
      decider_role_name_ar=NULL,decider_role_name_en='Branch Manager',approved_limit_source='PERSON',approved_limit_bps=2000,
      approver_is_performer=false,reject_reason=NULL WHERE company_id=${f.company} AND id=${id}`;
    return;
  }
  await f.h.owner`UPDATE discount_proposals SET status='REJECTED',decided_by=${f.editorId},
    decided_by_membership_id=${f.editorMembership},decided_via='REMOTE',decided_at='2026-10-15T09:00:00.000Z'::timestamptz,
    decider_name_ar='ليلى',decider_name_en='Layla Editor',decider_role='branch_manager',decider_role_is_system=true,
    decider_role_name_ar=NULL,decider_role_name_en='Branch Manager',reject_reason='The discount is too large'
    WHERE company_id=${f.company} AND id=${id}`;
}

it('DP-07 the requester reads her own proposals with their decisions', async () => {
  const body = await ask(3);
  await decide(must(body.proposals[0]?.id), 'APPROVED');
  await decide(must(body.proposals[1]?.id), 'REJECTED');
  const list = await f.requester.execute(scope(f.userId), { request_id: body.request_id });
  expect(list.items).toHaveLength(3);
  expect(list.items.map((item) => item.input_index)).toEqual([0, 1, 2]);
  const approved = list.items[0];
  expect(approved?.kind).toBe('RECORD');
  expect(approved?.status).toBe('APPROVED');
  expect(approved?.list_price).toBe('25.000');
  expect(approved?.price).toBe('25.000');
  expect(approved?.discount).toBe('5.000');
  expect(approved?.net).toBe('20.000');
  expect(approved?.effective_bps).toBe(2000);
  expect(approved?.decided_label_ar).toBe('ليلى');
  expect(approved?.decided_label_en).toBe('Layla Editor');
  expect(approved?.decided_via).toBe('REMOTE');
  expect(approved?.decided_at).toBe('2026-10-15T09:00:00.000000Z');
  expect(approved?.reject_reason).toBeUndefined();
  const rejected = list.items[1];
  expect(rejected?.status).toBe('REJECTED');
  expect(rejected?.reject_reason).toBe('The discount is too large');
  expect(rejected?.decided_via).toBe('REMOTE');
  const pending = list.items[2];
  expect(pending?.status).toBe('PENDING');
  expect(pending?.decided_label_ar).toBeUndefined();
  expect(pending?.decided_via).toBeUndefined();
  expect(pending?.decided_at).toBeUndefined();
  expect(pending?.reject_reason).toBeUndefined();
  expect(pending?.consumed_line_id).toBeUndefined();
});

it('DP-07 a proposal past its expiry reads as expired', async () => {
  const body = await ask(1);
  f.setAt(new Date('2026-10-16T08:00:00.000Z'));
  try {
    const list = await f.requester.execute(scope(f.userId), { request_id: body.request_id });
    expect(list.items[0]?.status).toBe('EXPIRED');
  } finally {
    f.setAt(AT);
  }
});

it('DP-07 another recorder reads an empty list, with no hint that the request exists', async () => {
  const body = await ask(1);
  const list = await f.requester.execute(scope(f.editorId), { request_id: body.request_id });
  expect(list.items).toEqual([]);
});

it('the approver list shows the live pending proposals with first names only', async () => {
  const body = await ask(5);
  const page = await f.pending.execute(scope(f.editorId), { limit: 100 });
  const mine = page.items.filter((item) => item.request_id === body.request_id);
  expect(mine).toHaveLength(5);
  const item = mine[0];
  expect(item?.performers).toEqual([{ employee_id: must(f.employees[1]), first_name_en: 'Sara', first_name_ar: 'سارة' }]);
  expect(item?.requester_label_en).toBe('Cashier');
  expect(item?.requester_label_ar).toBe('كاشير');
  expect(item?.customer_first_name).toBe('Synthetic');
  expect(item?.list_price).toBe('25.000');
  expect(item?.net).toBe('20.000');
  expect(item?.effective_bps).toBe(2000);
  const printed = JSON.stringify(page.items);
  expect(printed).not.toContain('999999998123');
  expect(printed).not.toContain('Synthetic customer');
});

it('the approver list pages through the pending proposals without a gap or a repeat', async () => {
  const seen: string[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await f.pending.execute(scope(f.editorId), { limit: 2, ...(cursor === undefined ? {} : { cursor }) });
    pages += 1;
    seen.push(...page.items.map((item) => item.id));
    cursor = page.next_cursor ?? undefined;
  } while (cursor !== undefined && pages < 10);
  expect(pages).toBeGreaterThan(1);
  expect(new Set(seen).size).toBe(seen.length);
  const page = await f.pending.execute(scope(f.editorId), { limit: 100 });
  expect(seen.length).toBe(page.items.length);
});

it('the approver list leaves out an expired or a decided proposal and refuses a broken cursor', async () => {
  const expired = ids.newId();
  await f.h.owner`INSERT INTO discount_proposals(company_id,id,business_id,branch_id,request_id,input_index,kind,session_id,occurred_at,
    customer_id,service_id,service_name_en,service_name_ar,terms,terms_hash,effective_bps,requested_by,requested_by_membership_id,
    requester_limit_source,requester_limit_bps,requester_name_ar,requester_name_en,requester_role,requester_role_is_system,
    requester_role_name_ar,requester_role_name_en,requester_first_name_en,requester_first_name_ar,customer_first_name,requested_at,status,expires_at)
    VALUES(${f.company},${expired},${f.business},${f.branch},${ids.newId()},0,'RECORD',NULL,'2026-10-15T08:00:00.000Z'::timestamptz,
      ${f.customer},${must(f.services[0])},'Synthetic service 0',NULL,'{}'::jsonb,${'a'.repeat(64)},2000,
      ${f.userId},${f.membership},'PERSON',1000,NULL,NULL,'cashier',true,NULL,'Cashier',NULL,NULL,'Synthetic',
      '2026-10-15T08:00:00.000Z'::timestamptz,'PENDING','2026-10-15T08:00:00.000Z'::timestamptz)`;
  await f.h.owner`INSERT INTO discount_proposal_performers(company_id,id,business_id,proposal_id,employee_id,linked_user_id,first_name_en,first_name_ar)
    VALUES(${f.company},${ids.newId()},${f.business},${expired},${must(f.employees[1])},${f.performerUserId},'Sara','سارة')`;
  const decided = await ask(1);
  await decide(must(decided.proposals[0]?.id), 'REJECTED');
  const page = await f.pending.execute(scope(f.editorId), { limit: 100 });
  expect(page.items.map((item) => item.id)).not.toContain(expired);
  expect(page.items.map((item) => item.id)).not.toContain(decided.proposals[0]?.id);
  await expect(f.pending.execute(scope(f.editorId), { limit: 20, cursor: 'not-a-cursor' })).rejects.toMatchObject({
    code: 'VALIDATION_FAILED',
  });
});

it('the pending list needs the approve permission, so the recorder is refused', async () => {
  const refused = await f.h.send('GET', `${f.proposalBase}/pending`, { cookie: f.cookie, company: f.company });
  expect(refused.status).toBe(403);
  expect(refused.body['code']).toBe('FORBIDDEN');
});
