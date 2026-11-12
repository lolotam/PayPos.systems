import { afterAll, beforeAll, expect, it } from 'vitest';
import { decideDiscountProposalsResponse } from '@pospay/contracts';
import { discountRequestFixture, ids, must, type DiscountRequestFixture } from './session.fixture.ts';
import { insertSecondEligibleMembership, requestSingleProposal } from './discount-decision.helpers.ts';

let f: DiscountRequestFixture;
const CLOCK = new Date('2026-10-15T08:00:00.000Z');

beforeAll(async () => {
  f = await discountRequestFixture({ ordersClock: { now: () => CLOCK } });
});

afterAll(async () => {
  await f?.close();
});

const postApprove = (body: object, cookie = f.editorCookie, key = ids.newId()) =>
  f.h.send('POST', `${f.proposalBase}/approve`, { cookie, company: f.company, key, body });

const postReject = (body: object, cookie = f.editorCookie, key = ids.newId()) =>
  f.h.send('POST', `${f.proposalBase}/reject`, { cookie, company: f.company, key, body });

it('both approve and reject routes declare guard and require Idempotency-Key', async () => {
  const proposal = await requestSingleProposal(f);
  const body = { proposal_ids: [proposal.id], terms_hashes: [proposal.terms_hash] };

  const noKeyApprove = await f.h.send('POST', `${f.proposalBase}/approve`, {
    cookie: f.editorCookie,
    company: f.company,
    body,
  });
  expect(noKeyApprove.status).toBe(400);
  expect(noKeyApprove.body['code']).toBe('IDEMPOTENCY_KEY_REQUIRED');

  const noKeyReject = await f.h.send('POST', `${f.proposalBase}/reject`, {
    cookie: f.editorCookie,
    company: f.company,
    body,
  });
  expect(noKeyReject.status).toBe(400);
  expect(noKeyReject.body['code']).toBe('IDEMPOTENCY_KEY_REQUIRED');

  const cashierApprove = await postApprove(body, f.cookie);
  expect(cashierApprove.status).toBe(403);
  expect(cashierApprove.body['code']).toBe('FORBIDDEN');

  const cashierReject = await postReject(body, f.cookie);
  expect(cashierReject.status).toBe(403);
  expect(cashierReject.body['code']).toBe('FORBIDDEN');
});

it('Zod-invalid body answers 400 VALIDATION_FAILED for mismatched counts or invalid format', async () => {
  const proposal = await requestSingleProposal(f);

  const mismatched = await postApprove({
    proposal_ids: [proposal.id],
    terms_hashes: [proposal.terms_hash, 'a'.repeat(64)],
  });
  expect(mismatched.status).toBe(400);
  expect(mismatched.body['code']).toBe('VALIDATION_FAILED');

  const emptyArray = await postApprove({
    proposal_ids: [],
    terms_hashes: [],
  });
  expect(emptyArray.status).toBe(400);
  expect(emptyArray.body['code']).toBe('VALIDATION_FAILED');

  const badHash = await postReject({
    proposal_ids: [proposal.id],
    terms_hashes: ['not-a-valid-sha256-hash'],
  });
  expect(badHash.status).toBe(400);
  expect(badHash.body['code']).toBe('VALIDATION_FAILED');
});

it('happy path approve and reject return 200 with decided proposals response', async () => {
  const pApprove = await requestSingleProposal(f);
  const approveRes = await postApprove({
    proposal_ids: [pApprove.id],
    terms_hashes: [pApprove.terms_hash],
  });
  expect(approveRes.status).toBe(200);
  const parsedApprove = decideDiscountProposalsResponse.parse(approveRes.body);
  expect(parsedApprove.proposals[0]?.status).toBe('APPROVED');
  expect(parsedApprove.proposals[0]?.id).toBe(pApprove.id);

  const pReject = await requestSingleProposal(f);
  const rejectRes = await postReject({
    proposal_ids: [pReject.id],
    terms_hashes: [pReject.terms_hash],
    reason: 'سعر غير مناسب',
  });
  expect(rejectRes.status).toBe(200);
  const parsedReject = decideDiscountProposalsResponse.parse(rejectRes.body);
  expect(parsedReject.proposals[0]?.status).toBe('REJECTED');
  expect(parsedReject.proposals[0]?.id).toBe(pReject.id);
});

it('maps DISCOUNT_PROPOSAL_NOT_PENDING to 409 with proposal_id in details', async () => {
  const proposal = await requestSingleProposal(f);
  const first = await postApprove({
    proposal_ids: [proposal.id],
    terms_hashes: [proposal.terms_hash],
  });
  expect(first.status).toBe(200);

  // Deciding on already approved proposal
  const conflict = await postApprove({
    proposal_ids: [proposal.id],
    terms_hashes: [proposal.terms_hash],
  });
  expect(conflict.status).toBe(409);
  expect(conflict.body['code']).toBe('DISCOUNT_PROPOSAL_NOT_PENDING');
  expect(conflict.body['details']).toEqual({ proposal_id: proposal.id });
});

it('maps DISCOUNT_PROPOSAL_CHANGED to 409 with proposal_id in details', async () => {
  const proposal = await requestSingleProposal(f);
  const wrongHash = '0'.repeat(64);
  const res = await postApprove({
    proposal_ids: [proposal.id],
    terms_hashes: [wrongHash],
  });
  expect(res.status).toBe(409);
  expect(res.body['code']).toBe('DISCOUNT_PROPOSAL_CHANGED');
  expect(res.body['details']).toEqual({ proposal_id: proposal.id });
});

it('maps DISCOUNT_APPROVER_LIMIT_TOO_LOW to 403 with details', async () => {
  const proposal = await requestSingleProposal(f, '7.500'); // 3000 bps
  const res = await postApprove({
    proposal_ids: [proposal.id],
    terms_hashes: [proposal.terms_hash],
  });
  expect(res.status).toBe(403);
  expect(res.body['code']).toBe('DISCOUNT_APPROVER_LIMIT_TOO_LOW');
  expect(res.body['details']).toEqual({
    proposal_id: proposal.id,
    limit_bps: 2000,
    effective_bps: 3000,
  });
});

it('maps DISCOUNT_APPROVER_IS_REQUESTER to 403 with details', async () => {
  const proposal = await requestSingleProposal(f);
  const overrideId = ids.newId();
  const [limitRow] = await f.h.owner`SELECT limit_bps FROM memberships WHERE company_id=${f.company} AND id=${f.membership}`;
  // قاعدة الحد بتتفحص قبل قاعدة الطالب (plan-40 صف 2)، فالطالبة لازم يكون حدها مغطي الخصم
  await f.h.owner`UPDATE memberships SET limit_bps=10000 WHERE company_id=${f.company} AND id=${f.membership}`;
  await f.h.owner`INSERT INTO permission_overrides (company_id, id, membership_id, permission_code, effect, scope_type, scope_id, reason, granted_by)
    VALUES (${f.company}, ${overrideId}, ${f.membership}, 'approve:discounts:branch', 'ALLOW', 'BRANCH', ${f.branch}, 'test', ${f.ownerId})`;

  try {
    const res = await postApprove({
      proposal_ids: [proposal.id],
      terms_hashes: [proposal.terms_hash],
    }, f.cookie);
    expect(res.status).toBe(403);
    expect(res.body['code']).toBe('DISCOUNT_APPROVER_IS_REQUESTER');
    expect(res.body['details']).toEqual({ proposal_id: proposal.id });
  } finally {
    await f.h.owner`DELETE FROM permission_overrides WHERE id=${overrideId}`;
    await f.h.owner`UPDATE memberships SET limit_bps=${must(limitRow)['limit_bps'] as number | null} WHERE company_id=${f.company} AND id=${f.membership}`;
  }
});

it('maps DISCOUNT_APPROVER_MEMBERSHIP_REQUIRED to 422 with details', async () => {
  const proposal = await requestSingleProposal(f);
  const secondMem = await insertSecondEligibleMembership(f, f.editorId);

  try {
    const res = await postApprove({
      proposal_ids: [proposal.id],
      terms_hashes: [proposal.terms_hash],
    });
    expect(res.status).toBe(422);
    expect(res.body['code']).toBe('DISCOUNT_APPROVER_MEMBERSHIP_REQUIRED');
    const details = res.body['details'] as { approver_membership_ids: string[] };
    expect(details.approver_membership_ids).toEqual(expect.arrayContaining([f.editorMembership, secondMem]));
  } finally {
    await f.h.owner`DELETE FROM memberships WHERE id=${secondMem}`;
  }
});

it('maps DISCOUNT_REJECT_REASON_INVALID to 422', async () => {
  const proposal = await requestSingleProposal(f);
  const res = await postReject({
    proposal_ids: [proposal.id],
    terms_hashes: [proposal.terms_hash],
    reason: '   \t\n  ',
  });
  expect(res.status).toBe(422);
  expect(res.body['code']).toBe('DISCOUNT_REJECT_REASON_INVALID');
});
