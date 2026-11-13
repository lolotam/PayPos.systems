import { afterAll, beforeAll, expect, it } from 'vitest';
import { SYSTEM_ROLES } from '@pospay/db';
import { deviceDiscountProposalList } from '@pospay/contracts';
import {
  DEVICE_PROPOSALS,
  discountPinFixture,
  type DiscountPinFixture,
} from '../../../../test/discount-pin.fixture.ts';
import {
  endMembership,
  fetchProposal,
  grantPerformerApprovalRole,
  insertSecondEligibleMembership,
  requestSingleProposal,
} from './discount-decision.helpers.ts';
import { ids, must } from './session.fixture.ts';

let f: DiscountPinFixture;

beforeAll(async () => {
  f = await discountPinFixture();
});

afterAll(async () => {
  await f?.close();
});

/** جسم قرار بالرقم السري، بلا مفتاح تكرير (FR-023). */
function decision(proposal: { id: string; terms_hash: string }, extra: object = {}) {
  return {
    proposal_ids: [proposal.id],
    terms_hashes: [proposal.terms_hash],
    phone: f.approver.phone,
    pin: f.approver.pin,
    ...extra,
  };
}

it('DP-09b two eligible memberships need an explicit pick, and a wrong PIN never answers 422', async () => {
  const proposal = await requestSingleProposal(f);
  const second = await insertSecondEligibleMembership(f, f.editorId);

  try {
    const refused = await f.devicePost(
      `${DEVICE_PROPOSALS}/approve`,
      f.device.token,
      decision(proposal),
    );
    expect(refused.statusCode).toBe(422);
    expect(refused.json().code).toBe('DISCOUNT_APPROVER_MEMBERSHIP_REQUIRED');
    const details = refused.json().details as { approver_membership_ids: string[] };
    expect(details.approver_membership_ids).toEqual(
      expect.arrayContaining([f.editorMembership, second]),
    );

    const wrongPin = await f.devicePost(
      `${DEVICE_PROPOSALS}/approve`,
      f.device.token,
      decision(proposal, { pin: '9999' }),
    );
    expect(wrongPin.statusCode).toBe(401);
    expect(wrongPin.json().code).toBe('PIN_INVALID');

    const picked = await f.devicePost(
      `${DEVICE_PROPOSALS}/approve`,
      f.device.token,
      decision(proposal, { approver_membership_id: second }),
    );
    expect(picked.statusCode).toBe(200);
    const row = must(await fetchProposal(f, proposal.id));
    expect(row['status']).toBe('APPROVED');
    expect(row['decided_by_membership_id']).toBe(second);
  } finally {
    await endMembership(f, second);
  }
});

it('DP-11 a proposal of another branch is refused on this branch device', async () => {
  const foreign = await f.seedProposal(f.otherBranch, {
    requestedAt: '2026-10-15T07:00:00.000Z',
    expiresAt: '2026-10-20T08:00:00.000Z',
  });
  const response = await f.devicePost(
    `${DEVICE_PROPOSALS}/approve`,
    f.device.token,
    decision({ id: foreign, terms_hash: 'a'.repeat(64) }),
  );
  expect(response.statusCode).toBe(403);
  expect(response.json().code).toBe('FORBIDDEN');
  expect(must(await fetchProposal(f, foreign))['status']).toBe('PENDING');
});

it('DP-11 the device of another branch decides nothing of this branch and lists none of it', async () => {
  const proposal = await requestSingleProposal(f);
  const refused = await f.devicePost(
    `${DEVICE_PROPOSALS}/approve`,
    f.otherDevice.token,
    decision(proposal),
  );
  expect(refused.statusCode).toBe(403);
  expect(refused.json().code).toBe('FORBIDDEN');

  const list = await f.deviceGet(`${DEVICE_PROPOSALS}`, f.otherDevice.token);
  expect(list.statusCode).toBe(200);
  const items = deviceDiscountProposalList.parse(list.json());
  expect(items.items.map((item) => item.id)).not.toContain(proposal.id);
  expect(must(await fetchProposal(f, proposal.id))['status']).toBe('PENDING');
});

it('DP-11 a revoked device is refused and writes nothing', async () => {
  const proposal = await requestSingleProposal(f);
  const device = await f.pairDevice(f.branch);
  const revoked = await f.h.send(
    'POST',
    `/v1/branches/${f.branch}/devices/${device.id}/revoke`,
    { cookie: f.ownerCookie, company: f.company },
  );
  expect(revoked.status).toBe(204);

  const response = await f.devicePost(
    `${DEVICE_PROPOSALS}/approve`,
    device.token,
    decision(proposal),
  );
  expect([401, 403]).toContain(response.statusCode);
  const row = must(await fetchProposal(f, proposal.id));
  expect(row['status']).toBe('PENDING');
  expect(row['decided_by']).toBeNull();
  expect(row['decided_via']).toBeNull();
});

it('DP-12 an approver whose only approving membership is at another branch is refused', async () => {
  const proposal = await requestSingleProposal(f);
  const role = must(SYSTEM_ROLES.find((item) => item.code === 'branch_manager')).id;
  const away = ids.newId();
  await f.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps,starts_at)
    VALUES(${f.company},${away},${f.editorId},${role},'global','BRANCH',${f.otherBranch},2000,'2026-01-01T00:00:00Z')`;
  await f.h.owner`UPDATE memberships SET ends_at='2026-01-02T00:00:00Z'
    WHERE company_id=${f.company} AND id=${f.editorMembership}`;

  try {
    const response = await f.devicePost(
      `${DEVICE_PROPOSALS}/approve`,
      f.device.token,
      decision(proposal),
    );
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
    const row = must(await fetchProposal(f, proposal.id));
    expect(row['status']).toBe('PENDING');
    expect(row['decided_by']).toBeNull();
  } finally {
    await f.h.owner`UPDATE memberships SET ends_at=NULL WHERE company_id=${f.company} AND id=${f.editorMembership}`;
    await f.h.owner`DELETE FROM memberships WHERE company_id=${f.company} AND id=${away}`;
  }
});

it('DP-19 the performer who approves by PIN is flagged and rings the owner bell', async () => {
  const role = await grantPerformerApprovalRole(f, 'branch_manager', 3000);
  const performer = await f.bind(f.performerUserId, '+99900000002');
  try {
    const proposal = await requestSingleProposal(f, '5.000', '25.000', 1);
    const response = await f.devicePost(
      `${DEVICE_PROPOSALS}/approve`,
      f.device.token,
      decision(proposal, { phone: performer.phone, pin: performer.pin }),
    );
    expect(response.statusCode).toBe(200);

    const row = must(await fetchProposal(f, proposal.id));
    expect(row['status']).toBe('APPROVED');
    expect(row['approver_is_performer']).toBe(true);
    expect(row['decided_via']).toBe('PIN');
    expect(row['decided_by']).toBe(f.performerUserId);

    const events = await f.h.owner`SELECT * FROM outbox WHERE company_id=${f.company}
      AND event_type='DiscountApprovedByPerformer' ORDER BY id`;
    expect(events).toHaveLength(1);
    const payload = must(events[0])['payload'] as { decided_via: string; proposals: Array<{ id: string }> };
    expect(payload.decided_via).toBe('PIN');
    expect(payload.proposals.map((entry) => entry.id)).toEqual([proposal.id]);
  } finally {
    await endMembership(f, role);
  }
});

it('DP-17 the PIN path refuses a discount above the approver limit', async () => {
  const proposal = await requestSingleProposal(f, '7.500');
  const response = await f.devicePost(
    `${DEVICE_PROPOSALS}/approve`,
    f.device.token,
    decision(proposal),
  );
  expect(response.statusCode).toBe(403);
  expect(response.json().code).toBe('DISCOUNT_APPROVER_LIMIT_TOO_LOW');
  expect(response.json().details).toEqual({
    proposal_id: proposal.id,
    limit_bps: 2000,
    effective_bps: 3000,
  });
  expect(must(await fetchProposal(f, proposal.id))['status']).toBe('PENDING');
});

it('DP-18 the requester cannot approve her own proposal with her PIN', async () => {
  const proposal = await requestSingleProposal(f);
  const requester = await f.bind(f.userId, '+99900000003');
  const overrideId = ids.newId();
  const [limitRow] = await f.h.owner`SELECT limit_bps FROM memberships
    WHERE company_id=${f.company} AND id=${f.membership}`;
  await f.h.owner`UPDATE memberships SET limit_bps=10000 WHERE company_id=${f.company} AND id=${f.membership}`;
  await f.h.owner`INSERT INTO permission_overrides (company_id, id, membership_id, permission_code, effect, scope_type, scope_id, reason, granted_by)
    VALUES (${f.company}, ${overrideId}, ${f.membership}, 'approve:discounts:branch', 'ALLOW', 'BRANCH', ${f.branch}, 'test', ${f.ownerId})`;

  try {
    const response = await f.devicePost(
      `${DEVICE_PROPOSALS}/approve`,
      f.device.token,
      decision(proposal, { phone: requester.phone, pin: requester.pin }),
    );
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('DISCOUNT_APPROVER_IS_REQUESTER');
    expect(response.json().details).toEqual({ proposal_id: proposal.id });
    expect(must(await fetchProposal(f, proposal.id))['status']).toBe('PENDING');
  } finally {
    await f.h.owner`DELETE FROM permission_overrides WHERE id=${overrideId}`;
    await f.h.owner`UPDATE memberships SET limit_bps=${must(limitRow)['limit_bps'] as number | null}
      WHERE company_id=${f.company} AND id=${f.membership}`;
  }
});
