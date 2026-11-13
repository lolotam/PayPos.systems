import { Writable } from 'node:stream';

import { STAFF_LOGIN_CONCURRENCY } from '@pospay/auth';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import { DISCOUNT_APPROVER_VERIFIER } from '../../../shared/discount-approver-pin.ts';
import {
  DEVICE_PROPOSALS,
  discountPinFixture,
  type DiscountPinFixture,
} from '../../../../test/discount-pin.fixture.ts';
import { fetchAudits, fetchProposal, requestSingleProposal } from './discount-decision.helpers.ts';
import { ids, must } from './session.fixture.ts';

let f: DiscountPinFixture;
let logs = '';

beforeAll(async () => {
  logs = '';
  f = await discountPinFixture({
    logs: new Writable({
      write(chunk, _encoding, done) {
        logs += String(chunk);
        done();
      },
    }),
  });
});

beforeEach(async () => {
  for (const userId of [f.editorId, f.ownerId]) {
    const base = `pin:${f.company}:staff-user:${userId}`;
    await f.h.redis.del(`${base}:lock`, `${base}:failures`, `${base}:reservations`);
  }
});

afterAll(async () => {
  await f?.close();
});

/** جسم قرار جهاز، مع إمكانية تبديل الهاتف أو الـ PIN في حالة الرفض. */
function decision(proposal: { id: string; terms_hash: string }, extra: object = {}) {
  return {
    proposal_ids: [proposal.id],
    terms_hashes: [proposal.terms_hash],
    phone: f.approver.phone,
    pin: f.approver.pin,
    ...extra,
  };
}

const approve = (proposal: { id: string; terms_hash: string }, token: string, extra: object = {}) =>
  f.devicePost(`${DEVICE_PROPOSALS}/approve`, token, decision(proposal, extra));

interface VerifierInput {
  phone: string;
  pin: string;
  device: { companyId: string; deviceId: string; branchId: string };
}

type VerifierOutcome =
  | { kind: 'ok'; userId: string; pinRevision: string }
  | { kind: 'refused' | 'locked' | 'busy' };

function pinVerifier() {
  return f.h.app.get<{
    execute(input: VerifierInput): Promise<VerifierOutcome>;
  }>(DISCOUNT_APPROVER_VERIFIER);
}

async function expectPending(id: string) {
  const row = must(await fetchProposal(f, id));
  expect(row['status']).toBe('PENDING');
  expect(row['decided_by']).toBeNull();
  expect(row['decided_via']).toBeNull();
  expect(row['decided_device_id']).toBeNull();
}

it('DP-08b device credentials never enter admin routes, admin cookies never enter device routes, and anonymous gets 401', async () => {
  const proposal = await requestSingleProposal(f);
  const adminHeaders = { authorization: `Device ${f.device.token}`, 'x-company-id': f.company };
  const adminPending = await f.h.app.inject({
    method: 'GET', url: `${f.proposalBase}/pending`, headers: adminHeaders,
  });
  const adminApprove = await f.h.app.inject({
    method: 'POST', url: `${f.proposalBase}/approve`, headers: adminHeaders,
    payload: { proposal_ids: [proposal.id], terms_hashes: [proposal.terms_hash] },
  });
  for (const response of [adminPending, adminApprove]) {
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
  }

  const cookieHeaders = { cookie: f.editorCookie, 'x-company-id': f.company };
  const adminOnDevice = [
    await f.h.app.inject({ method: 'GET', url: DEVICE_PROPOSALS, headers: cookieHeaders }),
    await f.h.app.inject({ method: 'POST', url: `${DEVICE_PROPOSALS}/approve`, headers: cookieHeaders, payload: decision(proposal) }),
    await f.h.app.inject({ method: 'POST', url: `${DEVICE_PROPOSALS}/reject`, headers: cookieHeaders, payload: decision(proposal) }),
  ];
  for (const response of adminOnDevice) {
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
  }

  const anonymous = [
    await f.h.app.inject({ method: 'GET', url: DEVICE_PROPOSALS }),
    await f.h.app.inject({ method: 'POST', url: `${DEVICE_PROPOSALS}/approve`, payload: decision(proposal) }),
    await f.h.app.inject({ method: 'POST', url: `${DEVICE_PROPOSALS}/reject`, payload: decision(proposal) }),
  ];
  for (const response of anonymous) expect(response.statusCode).toBe(401);
  await expectPending(proposal.id);
});

it('DP-10 the fifth wrong PIN locks the phone and a correct PIN stays locked without changing the proposal', async () => {
  const device = await f.pairDevice(f.branch);
  const proposal = await requestSingleProposal(f);
  const statuses: number[] = [];
  for (let index = 0; index < 5; index += 1) {
    const response = await approve(proposal, device.token, { pin: '9999' });
    statuses.push(response.statusCode);
    if (index === 4) expect(response.json().code).toBe('PIN_LOCKED');
    else expect(response.json().code).toBe('PIN_INVALID');
  }
  expect(statuses).toEqual([401, 401, 401, 401, 423]);
  const correct = await approve(proposal, device.token);
  expect(correct.statusCode).toBe(423);
  expect(correct.json().code).toBe('PIN_LOCKED');
  await expectPending(proposal.id);
});

it('DP-10 unknown and PIN-less users share one refusal body but have independent counters, and another phone works', async () => {
  const device = await f.pairDevice(f.branch);
  const unknownPhone = '+99900000990';
  const pinlessPhone = '+99900000991';
  await f.h.owner`UPDATE "user" SET phone_number=${pinlessPhone} WHERE id=${f.performerUserId}`;
  await f.h.owner`UPDATE "user" SET phone_binding_approved_at=clock_timestamp() WHERE id=${f.performerUserId}`;
  const unknown = await approve(await requestSingleProposal(f), device.token, { phone: unknownPhone, pin: '9999' });
  const pinless = await approve(await requestSingleProposal(f), device.token, { phone: pinlessPhone, pin: '9999' });
  expect(unknown.statusCode).toBe(401);
  expect(pinless.statusCode).toBe(401);
  expect(pinless.json()).toEqual(unknown.json());
  expect(unknown.json().code).toBe('PIN_INVALID');

  const unknownKey = f.h.auth.staff.pinCounterKey(unknownPhone);
  expect(await f.h.redis.get(`pin:${f.company}:${unknownKey}:failures`)).toBe('1');
  expect(await f.h.redis.get(`pin:${f.company}:staff-user:${f.performerUserId}:failures`)).toBe('1');

  const owner = await f.bind(f.ownerId, '+99900000992');
  const proposal = await requestSingleProposal(f);
  const working = await approve(proposal, device.token, { phone: owner.phone, pin: owner.pin });
  expect(working.statusCode).toBe(200);
});

it('DP-10 more than the login concurrency cap answers 429', async () => {
  const device = await f.pairDevice(f.branch);
  const owner = await f.bind(f.ownerId, '+99900000993');
  const proposal = await requestSingleProposal(f);
  const verifier = pinVerifier();
  const execute = verifier.execute.bind(verifier);
  const spy = vi.spyOn(verifier, 'execute').mockImplementation(async (input) => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return execute(input);
  });
  try {
    const responses = await Promise.all(
      Array.from({ length: STAFF_LOGIN_CONCURRENCY + 2 }, () =>
        approve(proposal, device.token, { phone: owner.phone, pin: owner.pin }),
      ),
    );
    expect(responses.some((response) => response.statusCode === 429)).toBe(true);
    const busy = responses.find((response) => response.statusCode === 429);
    expect(busy?.json().code).toBe('TOO_MANY_REQUESTS');
  } finally {
    spy.mockRestore();
  }
});

it('DP-10b ten phones lock one device once, while the other device and REMOTE route still approve', async () => {
  const device = await f.pairDevice(f.branch);
  const owner = await f.bind(f.ownerId, '+99900000994');
  const lockedProposal = await requestSingleProposal(f);
  const otherProposal = await f.seedProposal(f.otherBranch, {
    requestedAt: '2026-10-15T07:00:00.000Z', expiresAt: '2026-10-20T08:00:00.000Z',
  });
  const phones = Array.from({ length: 10 }, (_, index) => `+999000010${index}`);
  const statuses: number[] = [];
  for (const phone of phones) {
    const response = await approve(lockedProposal, device.token, { phone, pin: '9999' });
    statuses.push(response.statusCode);
  }
  expect(statuses).toEqual([401, 401, 401, 401, 401, 401, 401, 401, 401, 423]);
  expect((await approve(lockedProposal, device.token)).statusCode).toBe(423);
  expect((await approve(lockedProposal, device.token, { phone: phones[0] })).statusCode).toBe(423);
  const audits = await f.h.owner`SELECT * FROM audit_log WHERE company_id=${f.company}
    AND entity_id=${device.id} AND action='device.pin_approval_locked'`;
  expect(audits).toHaveLength(1);
  await expectPending(lockedProposal.id);

  const other = await approve(
    { id: otherProposal, terms_hash: 'a'.repeat(64) },
    f.otherDevice.token,
    { phone: owner.phone, pin: owner.pin },
  );
  expect(other.statusCode).toBe(200);
  const remote = await f.h.send('POST', `${f.proposalBase}/approve`, {
    cookie: f.editorCookie, company: f.company, key: ids.newId(),
    body: { proposal_ids: [lockedProposal.id], terms_hashes: [lockedProposal.terms_hash] },
  });
  expect(remote.status).toBe(200);
});

it('debate #2 a PIN reset between verification and decision refuses and writes nothing', async () => {
  const device = await f.pairDevice(f.branch);
  const proposal = await requestSingleProposal(f);
  const verifier = pinVerifier();
  const execute = verifier.execute.bind(verifier);
  const spy = vi.spyOn(verifier, 'execute').mockImplementation(async (input) => {
    const outcome = await execute(input);
    if (outcome.kind === 'ok') {
      await f.h.owner`UPDATE cashier_pins SET id=${ids.newId()} WHERE company_id=${f.company} AND user_id=${f.editorId}`;
    }
    return outcome;
  });
  try {
    const response = await approve(proposal, device.token);
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
    await expectPending(proposal.id);
    expect(await fetchAudits(f, proposal.id, 'discount_proposal.approved')).toHaveLength(0);
  } finally {
    spy.mockRestore();
  }
});

it('debate #2 revoking the device between verification and decision refuses and writes nothing', async () => {
  const device = await f.pairDevice(f.branch);
  const proposal = await requestSingleProposal(f);
  const verifier = pinVerifier();
  const execute = verifier.execute.bind(verifier);
  const spy = vi.spyOn(verifier, 'execute').mockImplementation(async (input) => {
    const outcome = await execute(input);
    if (outcome.kind === 'ok') {
      await f.h.owner`UPDATE devices SET status='REVOKED',token_hash=NULL,claim_hash=NULL,token_expires_at=NULL,
        revoked_at=clock_timestamp(),revoked_by=${f.ownerId} WHERE company_id=${f.company} AND id=${device.id}`;
    }
    return outcome;
  });
  try {
    const response = await approve(proposal, device.token);
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
    await expectPending(proposal.id);
    expect(await fetchAudits(f, proposal.id, 'discount_proposal.approved')).toHaveLength(0);
  } finally {
    spy.mockRestore();
  }
});

it('FR-023 logs, responses, audit, outbox and idempotency rows contain neither PIN values nor the full phone', async () => {
  const approved = await requestSingleProposal(f);
  const rejected = await requestSingleProposal(f);
  const wrong = await requestSingleProposal(f);
  const lockedProposal = await requestSingleProposal(f);
  const responses = [
    await approve(approved, f.device.token),
    await f.devicePost(`${DEVICE_PROPOSALS}/reject`, f.device.token, decision(rejected)),
    await approve(wrong, f.device.token, { pin: '9999' }),
  ];
  expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 401]);
  const lockedDevice = await f.pairDevice(f.branch);
  for (let index = 0; index < 5; index += 1) {
    await approve(lockedProposal, lockedDevice.token, { pin: '9999' });
  }
  const locked = await approve(lockedProposal, lockedDevice.token);
  expect(locked.statusCode).toBe(423);
  const invalid = await f.devicePost(
    `${DEVICE_PROPOSALS}/approve`, f.device.token, decision(approved, { pin: '12345' }),
  );
  expect(invalid.statusCode).toBe(400);
  const bodies = [...responses, locked, invalid].map((response) => response.body);

  const audits = await f.h.owner`SELECT * FROM audit_log WHERE company_id=${f.company}`;
  const outbox = await f.h.owner`SELECT * FROM outbox WHERE company_id=${f.company}`;
  const idempotency = await f.h.owner`SELECT * FROM idempotency_keys WHERE company_id=${f.company}`;
  for (const text of [logs, ...bodies, JSON.stringify(audits), JSON.stringify(outbox), JSON.stringify(idempotency)]) {
    expect(text).not.toContain(f.approver.phone);
    expect(text).not.toMatch(/"pin"\s*:\s*"1234"/);
  }
});
