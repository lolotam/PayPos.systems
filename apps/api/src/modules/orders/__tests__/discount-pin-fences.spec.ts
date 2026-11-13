import { Writable } from 'node:stream';

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

beforeAll(async () => {
  f = await discountPinFixture({
    logs: new Writable({
      write(_chunk, _encoding, done) {
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
  | { kind: 'ok'; userId: string; pinRevision: string; confirmBinding: () => Promise<boolean> }
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

it('debate #2 a phone rebinding between verification and decision refuses and writes nothing', async () => {
  const device = await f.pairDevice(f.branch);
  const proposal = await requestSingleProposal(f);
  const verifier = pinVerifier();
  const execute = verifier.execute.bind(verifier);
  const reboundPhone = '+99900000996';
  const spy = vi.spyOn(verifier, 'execute').mockImplementation(async (input) => {
    const outcome = await execute(input);
    if (outcome.kind === 'ok') {
      await f.h.owner`UPDATE "user" SET phone_number=${reboundPhone} WHERE id=${f.editorId}`;
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
    await f.h.owner`UPDATE "user" SET phone_number=${f.approver.phone} WHERE id=${f.editorId}`;
    await f.h.owner`UPDATE "user" SET phone_binding_approved_at=clock_timestamp() WHERE id=${f.editorId}`;
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

it('debate #2 an auth pool that is saturated while the binding is rechecked answers 409 TRANSACTION_RETRY_REQUIRED and writes nothing', async () => {
  const device = await f.pairDevice(f.branch);
  const proposal = await requestSingleProposal(f);
  const verifier = pinVerifier();
  const execute = verifier.execute.bind(verifier);
  const spy = vi.spyOn(verifier, 'execute').mockImplementation(async (input) => {
    const outcome = await execute(input);
    if (outcome.kind === 'ok') {
      return {
        ...outcome,
        confirmBinding: async () => {
          throw new Error('BOUNDED_DATABASE_UNAVAILABLE');
        },
      };
    }
    return outcome;
  });
  try {
    const response = await approve(proposal, device.token);
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('TRANSACTION_RETRY_REQUIRED');
    await expectPending(proposal.id);
    expect(await fetchAudits(f, proposal.id, 'discount_proposal.approved')).toHaveLength(0);
  } finally {
    spy.mockRestore();
  }
});
