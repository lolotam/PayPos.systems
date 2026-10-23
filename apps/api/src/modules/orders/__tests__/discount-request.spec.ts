import { createHash } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { discountApprovalRequested, requestDiscountApprovalResponse } from '@pospay/contracts';
import { buildDiscountTerms, canonicalDiscountTerms } from '../domain/discount-terms.ts';
import { ids, must, discountRequestFixture, type DiscountRequestFixture } from './session.fixture.ts';

let f: DiscountRequestFixture;
beforeAll(async () => { f = await discountRequestFixture(); });
afterAll(async () => { await f?.close(); });

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

async function proposalRows() {
  return f.h.owner`SELECT id,request_id,input_index,kind,session_id,occurred_at,customer_id,service_id,service_name_en,
    service_name_ar,terms,terms_hash,effective_bps,requested_by,requested_by_membership_id,requester_limit_source,requester_limit_bps,
    requester_name_ar,requester_name_en,requester_role,requester_role_is_system,requester_role_name_ar,requester_role_name_en,
    requester_first_name_en,requester_first_name_ar,customer_first_name,requested_at,status,expires_at,
    decided_by,decided_by_membership_id,decided_via,decided_device_id,decider_name_ar,decider_name_en,decider_role,
    decider_role_is_system,decider_role_name_ar,decider_role_name_en,decided_at,approved_limit_source,approved_limit_bps,
    approver_is_performer,reject_reason,consumed_line_id,consumed_edit_id,consumed_at
    FROM discount_proposals WHERE company_id=${f.company} ORDER BY input_index,id`;
}

async function performerRows() {
  return f.h.owner`SELECT proposal_id,employee_id,linked_user_id,first_name_en,first_name_ar
    FROM discount_proposal_performers WHERE company_id=${f.company} ORDER BY proposal_id,employee_id`;
}

async function storedCounts() {
  const [row] = await f.h.owner`SELECT
    (SELECT count(*)::int FROM discount_proposals WHERE company_id=${f.company}) AS proposals,
    (SELECT count(*)::int FROM discount_proposal_performers WHERE company_id=${f.company}) AS performers,
    (SELECT count(*)::int FROM audit_log WHERE company_id=${f.company} AND action='discount_proposal.requested') AS audits,
    (SELECT count(*)::int FROM outbox WHERE company_id=${f.company} AND event_type='DiscountApprovalRequested') AS events`;
  return row as Record<string, number>;
}

async function recordedVisit() {
  const recorded = await f.create.execute({ ...f.context(), input: f.body([f.line()]) });
  return recorded.session.id;
}

it('DP-01 one request stores one pending proposal, its performer, an audit, an event and a replayable 201', async () => {
  const sessionId = await recordedVisit();
  const key = ids.newId();
  const input = f.requestBody([f.draft(0, '25.000', '5.000', 1)], { session_id: sessionId });
  const result = await f.request.execute({ ...f.context(key), input });
  const body = requestDiscountApprovalResponse.parse(result);
  expect(body.proposals).toHaveLength(1);
  expect(body.occurred_at).toBe('2026-10-14T08:00:00.000Z');

  const rows = await proposalRows();
  expect(rows).toHaveLength(1);
  const row = rows[0] as Record<string, unknown>;
  const expectedTerms = buildDiscountTerms({
    company_id: f.company, business_id: f.business, branch_id: f.branch, customer_id: f.customer,
    session_id: sessionId, service_id: must(f.services[0]), requested_by: f.userId, requested_by_membership_id: f.membership,
    occurred_business_date: '2026-10-14', list_price: 25000n, price: 25000n, discount: 5000n, performer_ids: [must(f.employees[1])],
  });
  expect(row['status']).toBe('PENDING');
  expect(row['kind']).toBe('RECORD');
  expect(row['request_id']).toBe(body.request_id);
  expect(row['input_index']).toBe(0);
  expect(row['session_id']).toBe(sessionId);
  expect((row['occurred_at'] as Date).toISOString()).toBe('2026-10-14T08:00:00.000Z');
  expect(row['customer_id']).toBe(f.customer);
  expect(row['service_id']).toBe(must(f.services[0]));
  expect(row['service_name_en']).toBe('Synthetic service 0');
  expect(row['terms']).toEqual(expectedTerms);
  expect(row['terms_hash']).toBe(sha(canonicalDiscountTerms(expectedTerms)));
  expect(row['effective_bps']).toBe(2000);
  expect(row['requested_by']).toBe(f.userId);
  expect(row['requested_by_membership_id']).toBe(f.membership);
  expect(row['requester_limit_source']).toBe('PERSON');
  expect(row['requester_limit_bps']).toBe(1000);
  expect(row['requester_role']).toBe('cashier');
  expect(row['requester_role_is_system']).toBe(true);
  expect(row['requester_role_name_en']).toBe('Cashier');
  expect(row['customer_first_name']).toBe('Synthetic');
  expect((row['requested_at'] as Date).toISOString()).toBe('2026-10-15T08:00:00.000Z');
  expect((row['expires_at'] as Date).toISOString()).toBe('2026-10-16T08:00:00.000Z');
  for (const column of ['decided_by', 'decided_by_membership_id', 'decided_via', 'decided_device_id', 'decider_name_ar',
    'decider_name_en', 'decider_role', 'decider_role_is_system', 'decider_role_name_ar', 'decider_role_name_en', 'decided_at',
    'approved_limit_source', 'approved_limit_bps', 'approver_is_performer', 'reject_reason', 'consumed_line_id',
    'consumed_edit_id', 'consumed_at']) {
    expect(row[column]).toBeNull();
  }

  const performers = await performerRows();
  expect(performers).toHaveLength(1);
  expect(performers[0]).toMatchObject({
    proposal_id: body.proposals[0]?.id,
    employee_id: must(f.employees[1]),
    linked_user_id: f.performerUserId,
    first_name_en: 'Sara',
    first_name_ar: 'سارة',
  });

  const audits = await f.h.owner`SELECT after FROM audit_log WHERE company_id=${f.company}
    AND entity_id=${body.proposals[0]?.id} AND action='discount_proposal.requested'`;
  expect(audits).toHaveLength(1);
  expect(JSON.stringify(audits[0])).not.toContain('Synthetic customer');
  expect(JSON.stringify(audits[0])).not.toContain('Sara');

  const events = await f.h.owner`SELECT aggregate_type,aggregate_id,event_type,payload FROM outbox WHERE company_id=${f.company}
    AND event_type='DiscountApprovalRequested'`;
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ aggregate_type: 'discount_approval_request', aggregate_id: body.request_id });
  const payload = discountApprovalRequested.parse(events[0]?.['payload']);
  expect(payload.line_count).toBe(1);
  expect(payload.max_effective_bps).toBe(2000);
  expect(payload.services).toHaveLength(1);

  const counts = await storedCounts();
  const replay = await f.request.execute({ ...f.context(key), input });
  expect(replay).toEqual(result);
  expect(await storedCounts()).toEqual(counts);
});

it('DP-03 three lines above the limit share one request id and one bell', async () => {
  const input = f.requestBody([
    f.draft(0, '25.000', '5.000', 1),
    f.draft(0, '25.000', '7.500', 1),
    f.draft(1, '7.125', '1.000', 1),
  ]);
  const body = requestDiscountApprovalResponse.parse(await f.request.execute({ ...f.context(), input }));
  expect(body.proposals.map((proposal) => proposal.input_index)).toEqual([0, 1, 2]);
  const rows = await proposalRows();
  const mine = rows.filter((row) => row['request_id'] === body.request_id);
  expect(mine).toHaveLength(3);
  expect(new Set(mine.map((row) => row['request_id'])).size).toBe(1);
  const events = await f.h.owner`SELECT payload FROM outbox WHERE company_id=${f.company}
    AND aggregate_id=${body.request_id} AND event_type='DiscountApprovalRequested'`;
  expect(events).toHaveLength(1);
  const payload = discountApprovalRequested.parse(events[0]?.['payload']);
  expect(payload.line_count).toBe(3);
  expect(payload.max_effective_bps).toBe(3000);
  expect(payload.services.map((entry) => entry.service_id)).toEqual([must(f.services[0]), must(f.services[1])]);
});

it('DP-04 a line inside the limit refuses the whole request and stores nothing', async () => {
  const key = ids.newId();
  const before = await storedCounts();
  const input = f.requestBody([
    f.draft(0, '25.000', '5.000', 1),
    f.draft(0, '25.000', '2.500', 1),
    f.draft(0, '25.000', '7.500', 1),
  ]);
  await expect(f.request.execute({ ...f.context(key), input })).rejects.toMatchObject({
    code: 'DISCOUNT_APPROVAL_NOT_NEEDED',
    details: { input_indexes: [1] },
  });
  expect(await storedCounts()).toEqual(before);
  const keys = await f.h.owner`SELECT 1 FROM idempotency_keys WHERE company_id=${f.company} AND key=${key}`;
  expect(keys).toHaveLength(0);
});

it('DP-04 the owner never needs an approval, so every line is refused', async () => {
  const before = await storedCounts();
  const input = f.requestBody([f.draft(0, '25.000', '5.000', 1), f.draft(0, '25.000', '2.500', 1)]);
  await expect(f.request.execute({ ...f.context(ids.newId(), f.ownerId), input })).rejects.toMatchObject({
    code: 'DISCOUNT_APPROVAL_NOT_NEEDED',
    details: { input_indexes: [0, 1] },
  });
  expect(await storedCounts()).toEqual(before);
});

it('DP-05 the requester as a performer and an unknown service are refused, and nothing is stored', async () => {
  const before = await storedCounts();
  await f.linkEmployee(must(f.employees[0]), f.userId);
  try {
    await expect(f.request.execute({ ...f.context(), input: f.requestBody([f.draft(0, '25.000', '5.000', 0)]) }))
      .rejects.toThrow('SESSION_PERFORMER_SELF_FORBIDDEN');
  } finally {
    await f.linkEmployee(must(f.employees[0]), null);
  }
  const unknown = f.requestBody([{ ...f.draft(0, '25.000', '5.000', 1), service_id: ids.newId() }]);
  await expect(f.request.execute({ ...f.context(), input: unknown })).rejects.toThrow('SESSION_SERVICE_NOT_FOUND');
  expect(await storedCounts()).toEqual(before);
});
