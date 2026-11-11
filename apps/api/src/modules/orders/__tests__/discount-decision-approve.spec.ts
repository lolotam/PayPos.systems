import { afterAll, beforeAll, expect, it } from 'vitest';
import { discountRequestFixture, ids, must, type DiscountRequestFixture } from './session.fixture.ts';
import {
  createDecideUseCase,
  decideContext,
  endMembership,
  fetchAudits,
  fetchOutboxEvents,
  fetchProposal,
  grantPerformerApprovalRole,
  insertSecondEligibleMembership,
  requestBatchProposals,
  requestSingleProposal,
} from './discount-decision.helpers.ts';
import type { DecideDiscountProposalsUseCase } from '../use-cases/decide-discount-proposals/decide-discount-proposals.usecase.ts';

let f: DiscountRequestFixture;
let decide: DecideDiscountProposalsUseCase;
let editorRoleId: string;

beforeAll(async () => {
  f = await discountRequestFixture();
  decide = createDecideUseCase(f);
  const [row] = await f.h.owner`SELECT role_id FROM memberships WHERE id=${f.editorMembership}`;
  editorRoleId = must(row)['role_id'];
});

afterAll(async () => {
  await f?.close();
});

it('DP-13 owner approves 3000 bps remotely: 200, row APPROVED, decided_via REMOTE, device NULL, expires_at unchanged, one audit, no outbox', async () => {
  const outboxBefore = await fetchOutboxEvents(f);
  const proposal = await requestSingleProposal(f, '7.500'); // 7.500 / 25.000 = 3000 bps
  const response = await decide.execute({
    ...decideContext(f, f.ownerId),
    decision: 'APPROVE',
    input: { proposal_ids: [proposal.id], terms_hashes: [proposal.terms_hash] },
  });

  expect(response.proposals).toHaveLength(1);
  expect(response.proposals[0]?.status).toBe('APPROVED');
  expect(response.proposals[0]?.expires_at).toBe(proposal.expires_at);

  const row = must(await fetchProposal(f, proposal.id));
  expect(row['status']).toBe('APPROVED');
  expect(row['decided_via']).toBe('REMOTE');
  expect(row['decided_device_id']).toBeNull();
  expect(row['decided_by']).toBe(f.ownerId);
  expect(row['decided_by_membership_id']).toBe(f.ownerMembership);
  expect(new Date(row['expires_at'] as string).toISOString()).toBe(proposal.expires_at);
  expect(row['approved_limit_source']).toBe('OWNER');
  expect(row['approved_limit_bps']).toBeNull();
  expect(row['approver_is_performer']).toBe(false);

  const audits = await fetchAudits(f, proposal.id, 'discount_proposal.approved');
  expect(audits).toHaveLength(1);
  const audit = must(audits[0]);
  expect(audit['after']).toMatchObject({
    status: 'APPROVED',
    decided_by: f.ownerId,
    decided_via: 'REMOTE',
    approved_limit_source: 'OWNER',
    approver_is_performer: false,
  });

  const events = await fetchOutboxEvents(f);
  expect(events.length).toBe(outboxBefore.length);
});

it('DP-17 limit too low fails with DISCOUNT_APPROVER_LIMIT_TOO_LOW; NOT_CONFIGURED fails; owner passes', async () => {
  const proposal = await requestSingleProposal(f, '7.500'); // 3000 bps
  // Layla has 2000 bps limit
  await expect(decide.execute({
    ...decideContext(f, f.editorId),
    decision: 'APPROVE',
    input: { proposal_ids: [proposal.id], terms_hashes: [proposal.terms_hash] },
  })).rejects.toMatchObject({
    code: 'DISCOUNT_APPROVER_LIMIT_TOO_LOW',
    details: { proposal_id: proposal.id, limit_bps: 2000, effective_bps: 3000 },
  });

  // Create membership with NOT_CONFIGURED (limit_bps = null and no business default)
  const notConfiguredMem = ids.newId();
  const prevSettings = await f.h.owner`SELECT * FROM business_settings WHERE company_id=${f.company} AND business_id=${f.business}`;
  await f.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps,starts_at)
    VALUES(${f.company},${notConfiguredMem},${f.editorId},${editorRoleId},'global','BRANCH',${f.branch},NULL,'2026-01-01T00:00:00Z')`;
  await f.h.owner`DELETE FROM business_settings WHERE company_id=${f.company} AND business_id=${f.business}`;

  try {
    await expect(decide.execute({
      ...decideContext(f, f.editorId),
      decision: 'APPROVE',
      input: {
        proposal_ids: [proposal.id],
        terms_hashes: [proposal.terms_hash],
        approver_membership_id: notConfiguredMem,
      },
    })).rejects.toMatchObject({
      code: 'DISCOUNT_APPROVER_LIMIT_TOO_LOW',
      details: { proposal_id: proposal.id, limit_bps: 0, effective_bps: 3000 },
    });
  } finally {
    await f.h.owner`DELETE FROM memberships WHERE id=${notConfiguredMem}`;
    if (prevSettings.length > 0) {
      const s = must(prevSettings[0]);
      await f.h.owner`INSERT INTO business_settings(company_id,business_id,limit_bps) VALUES(${f.company},${f.business},${s['limit_bps']})`;
    }
  }

  // Owner passes any limit
  const ownerOk = await decide.execute({
    ...decideContext(f, f.ownerId),
    decision: 'APPROVE',
    input: { proposal_ids: [proposal.id], terms_hashes: [proposal.terms_hash] },
  });
  expect(ownerOk.proposals[0]?.status).toBe('APPROVED');
});

it('DP-18 requester approves own proposal fails with 403 DISCOUNT_APPROVER_IS_REQUESTER even with permission', async () => {
  const proposal = await requestSingleProposal(f);
  const overrideId = ids.newId();
  const [limitRow] = await f.h.owner`SELECT limit_bps FROM memberships WHERE company_id=${f.company} AND id=${f.membership}`;
  // قاعدة الحد بتتفحص قبل قاعدة الطالب (plan-40 صف 2)، فالطالبة لازم يكون حدها مغطي الخصم
  await f.h.owner`UPDATE memberships SET limit_bps=10000 WHERE company_id=${f.company} AND id=${f.membership}`;
  await f.h.owner`INSERT INTO permission_overrides (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${f.company},${overrideId},${f.membership},'approve:discounts:branch','ALLOW','BRANCH',${f.branch},'test',${f.ownerId})`;

  try {
    await expect(decide.execute({
      ...decideContext(f, f.userId),
      decision: 'APPROVE',
      input: { proposal_ids: [proposal.id], terms_hashes: [proposal.terms_hash] },
    })).rejects.toMatchObject({
      code: 'DISCOUNT_APPROVER_IS_REQUESTER',
      details: { proposal_id: proposal.id },
    });
  } finally {
    await f.h.owner`DELETE FROM permission_overrides WHERE id=${overrideId}`;
    await f.h.owner`UPDATE memberships SET limit_bps=${must(limitRow)['limit_bps'] as number | null} WHERE company_id=${f.company} AND id=${f.membership}`;
  }
});

it('DP-19 approver is performer sets approver_is_performer true and emits DiscountApprovedByPerformer with flagged proposals only', async () => {
  const roleMem = await grantPerformerApprovalRole(f, 'branch_manager', 3000);
  try {
    const proposals = await requestBatchProposals(f, [
      { employeeIndex: 1, discount: '5.000' }, // performer is performerUserId
      { employeeIndex: 0, discount: '5.000' }, // performer is synthetic employee 0
    ]);
    const p1 = must(proposals[0]);
    const p2 = must(proposals[1]);

    const response = await decide.execute({
      ...decideContext(f, f.performerUserId),
      decision: 'APPROVE',
      input: { proposal_ids: [p1.id, p2.id], terms_hashes: [p1.terms_hash, p2.terms_hash] },
    });
    expect(response.proposals).toHaveLength(2);

    const row1 = must(await fetchProposal(f, p1.id));
    const row2 = must(await fetchProposal(f, p2.id));
    expect(row1['approver_is_performer']).toBe(true);
    expect(row2['approver_is_performer']).toBe(false);

    const events = await fetchOutboxEvents(f);
    const decisionEvent = events.find((e) => (e['payload'] as Record<string, unknown>)?.['decided_by'] === f.performerUserId);
    expect(decisionEvent).toBeDefined();
    const payload = decisionEvent?.['payload'] as { proposals: Array<{ id: string }> };
    expect(payload.proposals).toHaveLength(1);
    expect(payload.proposals[0]?.id).toBe(p1.id);
  } finally {
    await endMembership(f, roleMem);
  }
});

it('DP-19b performer relinked after request and user linked after request both count', async () => {
  const performerRoleMem = await grantPerformerApprovalRole(f, 'branch_manager', 3000);
  const newApproverMem = ids.newId();
  const emp0 = must(f.employees[0]);
  try {
    const proposal1 = await requestSingleProposal(f, '5.000', '25.000', 1);
    await f.h.owner`UPDATE employees SET user_id=NULL WHERE company_id=${f.company} AND id=${f.performerEmployeeId}`;
    await decide.execute({
      ...decideContext(f, f.performerUserId),
      decision: 'APPROVE',
      input: { proposal_ids: [proposal1.id], terms_hashes: [proposal1.terms_hash] },
    });
    const row1 = must(await fetchProposal(f, proposal1.id));
    expect(row1['approver_is_performer']).toBe(true);

    await f.h.signedInOperator('new-performer-approver@example.test');
    const users = await f.h.owner`SELECT id FROM "user" WHERE email='new-performer-approver@example.test'`;
    const newUserId = must(users[0])['id'] as string;
    await f.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps,starts_at)
      VALUES(${f.company},${newApproverMem},${newUserId},${editorRoleId},'global','BRANCH',${f.branch},3000,'2026-01-01T00:00:00Z')`;

    const proposal2 = await requestSingleProposal(f, '5.000', '25.000', 0);
    await f.h.owner`UPDATE employees SET user_id=${newUserId} WHERE company_id=${f.company} AND id=${emp0}`;
    await decide.execute({
      ...decideContext(f, newUserId),
      decision: 'APPROVE',
      input: { proposal_ids: [proposal2.id], terms_hashes: [proposal2.terms_hash] },
    });
    const row2 = must(await fetchProposal(f, proposal2.id));
    expect(row2['approver_is_performer']).toBe(true);
  } finally {
    await endMembership(f, performerRoleMem);
    await endMembership(f, newApproverMem);
    await f.h.owner`UPDATE employees SET user_id=${f.performerUserId} WHERE company_id=${f.company} AND id=${f.performerEmployeeId}`;
    await f.h.owner`UPDATE employees SET user_id=NULL WHERE company_id=${f.company} AND id=${emp0}`;
  }
});

it('D-11 two eligible memberships and none chosen returns 422; supplied ineligible 403; supplied eligible 200', async () => {
  const proposal = await requestSingleProposal(f);
  const secondMem = await insertSecondEligibleMembership(f, f.editorId);
  try {
    await expect(decide.execute({
      ...decideContext(f, f.editorId),
      decision: 'APPROVE',
      input: { proposal_ids: [proposal.id], terms_hashes: [proposal.terms_hash] },
    })).rejects.toMatchObject({
      code: 'DISCOUNT_APPROVER_MEMBERSHIP_REQUIRED',
      details: { approver_membership_ids: expect.arrayContaining([f.editorMembership, secondMem]) },
    });

    await expect(decide.execute({
      ...decideContext(f, f.editorId),
      decision: 'APPROVE',
      input: { proposal_ids: [proposal.id], terms_hashes: [proposal.terms_hash], approver_membership_id: ids.newId() },
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const approved = await decide.execute({
      ...decideContext(f, f.editorId),
      decision: 'APPROVE',
      input: { proposal_ids: [proposal.id], terms_hashes: [proposal.terms_hash], approver_membership_id: secondMem },
    });
    expect(approved.proposals[0]?.status).toBe('APPROVED');
    const row = must(await fetchProposal(f, proposal.id));
    expect(row['decided_by_membership_id']).toBe(secondMem);
  } finally {
    await endMembership(f, secondMem);
  }
});

it('scope check: proposal of another branch or foreign id returns uniform 403 FORBIDDEN', async () => {
  const proposal = await requestSingleProposal(f);
  const input = { proposal_ids: [proposal.id], terms_hashes: [proposal.terms_hash] };
  await expect(decide.execute({ ...decideContext(f, f.editorId, { branchId: f.otherBranch }), decision: 'APPROVE', input }))
    .rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(decide.execute({
    ...decideContext(f, f.editorId),
    decision: 'APPROVE',
    input: { proposal_ids: [ids.newId()], terms_hashes: [proposal.terms_hash] },
  })).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

it('terms hash mismatch throws 409 DISCOUNT_PROPOSAL_CHANGED', async () => {
  const proposal = await requestSingleProposal(f);
  await expect(decide.execute({
    ...decideContext(f, f.editorId),
    decision: 'APPROVE',
    input: { proposal_ids: [proposal.id], terms_hashes: ['0'.repeat(64)] },
  })).rejects.toMatchObject({ code: 'DISCOUNT_PROPOSAL_CHANGED', details: { proposal_id: proposal.id } });
});

it('DENY on another active membership excludes approver with 403 FORBIDDEN', async () => {
  const proposal = await requestSingleProposal(f);
  const denyMem = ids.newId();
  const overrideId = ids.newId();
  await f.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps,starts_at)
    VALUES(${f.company},${denyMem},${f.editorId},${editorRoleId},'global','BRANCH',${f.branch},2000,'2026-01-01T00:00:00Z')`;
  await f.h.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${overrideId},${denyMem},'approve:discounts:branch','DENY','BRANCH',${f.branch},'test',${f.ownerId})`;

  try {
    await expect(decide.execute({
      ...decideContext(f, f.editorId),
      decision: 'APPROVE',
      input: { proposal_ids: [proposal.id], terms_hashes: [proposal.terms_hash] },
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  } finally {
    await f.h.owner`DELETE FROM permission_overrides WHERE id=${overrideId}`;
    await f.h.owner`DELETE FROM memberships WHERE id=${denyMem}`;
  }
});

it('orders feature off returns 403 FEATURE_DISABLED', async () => {
  const proposal = await requestSingleProposal(f);
  await f.h.owner`INSERT INTO company_feature_overrides (company_id, flag, enabled, reason, set_by)
    VALUES (${f.company}, 'orders', false, 'test', ${f.ownerId}) ON CONFLICT (company_id, flag) DO UPDATE SET enabled = false, reason = 'test'`;

  try {
    await expect(decide.execute({
      ...decideContext(f, f.editorId),
      decision: 'APPROVE',
      input: { proposal_ids: [proposal.id], terms_hashes: [proposal.terms_hash] },
    })).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
  } finally {
    await f.h.owner`DELETE FROM company_feature_overrides WHERE company_id = ${f.company} AND flag = 'orders'`;
  }
});
