import { afterAll, beforeAll, expect, it } from 'vitest';
import { decideDiscountProposalsResponse, deviceDiscountProposalList } from '@pospay/contracts';
import {
  DEVICE_PROPOSALS,
  discountPinFixture,
  PIN_CLOCK,
  type DiscountPinFixture,
} from '../../../../test/discount-pin.fixture.ts';
import {
  fetchAudits,
  fetchOutboxEvents,
  fetchProposal,
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

/** يقرأ قائمة طلبات الفرع على الجهاز ويجيبها سكيما العقد. */
async function listOf(token = f.device.token, query = '') {
  const response = await f.deviceGet(`${DEVICE_PROPOSALS}${query}`, token);
  expect(response.statusCode).toBe(200);
  return deviceDiscountProposalList.parse(response.json());
}

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

/** كل مفاتيح الرد بالاسم، في أي عمق. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return [...Object.keys(record), ...Object.values(record).flatMap(keysOf)];
  }
  return [];
}

it('DP-08 the device lists the live pending proposals of its own branch only', async () => {
  const expiring = await requestSingleProposal(f);
  const elsewhere = await f.seedProposal(f.otherBranch, {
    requestedAt: '2026-10-15T07:00:00.000Z',
    expiresAt: '2026-10-20T08:00:00.000Z',
  });

  f.setAt(new Date('2026-10-16T09:00:00.000Z'));
  try {
    const mine = await requestSingleProposal(f);
    const listed = (await listOf()).items.map((item) => item.id);
    expect(listed).toContain(mine.id);
    expect(listed).not.toContain(elsewhere);
    expect(listed).not.toContain(expiring.id);
  } finally {
    f.setAt(PIN_CLOCK);
  }
});

it('DP-08 the device list carries no phone, no performers and no performer ids', async () => {
  const proposal = await requestSingleProposal(f);
  const list = await listOf();
  expect(list.items.map((item) => item.id)).toContain(proposal.id);

  const keys = keysOf(list);
  expect(keys).not.toContain('phone');
  expect(keys).not.toContain('performers');
  expect(keys).not.toContain('performer_ids');
  expect(JSON.stringify(list)).not.toContain(f.approver.phone);
});

it('DP-08 the requester first name falls back to the role label when the snapshot has no name', async () => {
  const id = await f.seedProposal(f.branch, {
    requestedAt: '2026-10-15T07:00:00.000Z',
    expiresAt: '2026-10-20T08:00:00.000Z',
  });

  const anonymous = await listOf();
  const item = anonymous.items.find((entry) => entry.id === id);
  expect(item?.requester_first_name_en).toBe('Cashier');
  expect(item?.customer_first_name).toBe('Synthetic');
});

it('DP-08 the device list pages through the proposals without a gap or a repeat', async () => {
  const seeded: string[] = [];
  for (const at of ['2026-10-15T06:00:00.000Z', '2026-10-15T05:00:00.000Z', '2026-10-15T04:00:00.000Z']) {
    seeded.push(await f.seedProposal(f.branch, {
      requestedAt: at,
      expiresAt: '2026-10-20T08:00:00.000Z',
    }));
  }
  const full = await listOf(f.device.token, '?limit=100');
  const seen: string[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const query = cursor === undefined ? '?limit=1' : `?limit=1&cursor=${encodeURIComponent(cursor)}`;
    const page = await listOf(f.device.token, query);
    pages += 1;
    seen.push(...page.items.map((item) => item.id));
    cursor = page.next_cursor ?? undefined;
  } while (cursor !== undefined && pages < 50);

  expect(pages).toBeGreaterThan(1);
  expect(new Set(seen).size).toBe(seen.length);
  expect(seen).toEqual(full.items.map((item) => item.id));
  for (const id of seeded) expect(seen).toContain(id);
});

it('DP-08 a broken cursor and a foreign cursor are both refused with 400', async () => {
  const broken = await f.deviceGet(`${DEVICE_PROPOSALS}?cursor=not-a-cursor`, f.device.token);
  expect(broken.statusCode).toBe(400);
  expect(broken.json().code).toBe('VALIDATION_FAILED');

  const foreign = Buffer.from(JSON.stringify({
    v: 1,
    company: f.otherCompany,
    branch: f.branch,
    at: '2026-10-15T08:00:00.000000Z',
    id: ids.newId(),
  })).toString('base64url');
  const refused = await f.deviceGet(
    `${DEVICE_PROPOSALS}?cursor=${encodeURIComponent(foreign)}`,
    f.device.token,
  );
  expect(refused.statusCode).toBe(400);
  expect(refused.json().code).toBe('VALIDATION_FAILED');
});

it('DP-09 the PIN approves the proposal: row, audit and no event', async () => {
  const proposal = await requestSingleProposal(f);
  const eventsBefore = await fetchOutboxEvents(f);

  const response = await f.devicePost(
    `${DEVICE_PROPOSALS}/approve`,
    f.device.token,
    decision(proposal),
  );
  expect(response.statusCode).toBe(200);
  const body = decideDiscountProposalsResponse.parse(response.json());
  expect(body.proposals[0]?.id).toBe(proposal.id);
  expect(body.proposals[0]?.status).toBe('APPROVED');
  expect(body.proposals[0]?.expires_at).toBe(proposal.expires_at);

  const row = must(await fetchProposal(f, proposal.id));
  expect(row['status']).toBe('APPROVED');
  expect(row['decided_via']).toBe('PIN');
  expect(row['decided_device_id']).toBe(f.device.id);
  expect(row['decided_by']).toBe(f.editorId);
  expect(row['decided_by_membership_id']).toBe(f.editorMembership);
  expect(new Date(row['expires_at'] as string).toISOString()).toBe(proposal.expires_at);
  expect(row['approver_is_performer']).toBe(false);

  const audits = await fetchAudits(f, proposal.id, 'discount_proposal.approved');
  expect(audits).toHaveLength(1);
  expect(must(audits[0])['after']).toMatchObject({
    status: 'APPROVED',
    decided_by: f.editorId,
    decided_via: 'PIN',
    decided_device_id: f.device.id,
  });

  const events = await fetchOutboxEvents(f);
  expect(events.length).toBe(eventsBefore.length);
});

it('DP-09 a second decision on the same proposal is 409 and nothing changes', async () => {
  const proposal = await requestSingleProposal(f);
  const first = await f.devicePost(`${DEVICE_PROPOSALS}/approve`, f.device.token, decision(proposal));
  expect(first.statusCode).toBe(200);

  const again = await f.devicePost(`${DEVICE_PROPOSALS}/approve`, f.device.token, decision(proposal));
  expect(again.statusCode).toBe(409);
  expect(again.json().code).toBe('DISCOUNT_PROPOSAL_NOT_PENDING');
  expect(again.json().details).toEqual({ proposal_id: proposal.id });

  const audits = await fetchAudits(f, proposal.id, 'discount_proposal.approved');
  expect(audits).toHaveLength(1);
});

it('DP-09 the PIN rejects the proposal with a reason and without one', async () => {
  const withReason = await requestSingleProposal(f);
  const rejected = await f.devicePost(
    `${DEVICE_PROPOSALS}/reject`,
    f.device.token,
    decision(withReason, { reason: 'الخصم كبير' }),
  );
  expect(rejected.statusCode).toBe(200);
  expect(decideDiscountProposalsResponse.parse(rejected.json()).proposals[0]?.status).toBe('REJECTED');

  const row = must(await fetchProposal(f, withReason.id));
  expect(row['status']).toBe('REJECTED');
  expect(row['decided_via']).toBe('PIN');
  expect(row['decided_device_id']).toBe(f.device.id);
  expect(row['decided_by']).toBe(f.editorId);
  expect(row['approver_is_performer']).toBeNull();
  expect(row['reject_reason']).toBe('الخصم كبير');
  expect(new Date(row['expires_at'] as string).toISOString()).toBe(withReason.expires_at);

  const plain = await requestSingleProposal(f);
  const noReason = await f.devicePost(`${DEVICE_PROPOSALS}/reject`, f.device.token, decision(plain));
  expect(noReason.statusCode).toBe(200);
  const plainRow = must(await fetchProposal(f, plain.id));
  expect(plainRow['status']).toBe('REJECTED');
  expect(plainRow['reject_reason']).toBeNull();
});

it('DP-09 a wrong terms hash is refused with 409 and the proposal stays pending', async () => {
  const proposal = await requestSingleProposal(f);
  const response = await f.devicePost(
    `${DEVICE_PROPOSALS}/approve`,
    f.device.token,
    decision(proposal, { terms_hashes: ['0'.repeat(64)] }),
  );
  expect(response.statusCode).toBe(409);
  expect(response.json().code).toBe('DISCOUNT_PROPOSAL_CHANGED');
  expect(response.json().details).toEqual({ proposal_id: proposal.id });

  const row = must(await fetchProposal(f, proposal.id));
  expect(row['status']).toBe('PENDING');
  expect(row['decided_via']).toBeNull();
  expect(row['decided_device_id']).toBeNull();
  expect(await fetchAudits(f, proposal.id, 'discount_proposal.approved')).toHaveLength(0);
});
