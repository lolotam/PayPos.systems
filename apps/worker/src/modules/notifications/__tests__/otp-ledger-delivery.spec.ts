import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createStaffOtpExecution } from '@pospay/auth';
import {
  FakeChannel,
  createPhoneIdentity,
  createProviderMessageDigest,
  phoneLockKey,
} from '@pospay/notifications';
import { otpFixture, phone, device } from '../../../../../../packages/db/test/otp-fixtures.ts';
import { createOtpCrypto } from '../../../../../../packages/auth/src/staff-otp/crypto.ts';
import { SendStaffOtp } from '../use-cases/send-staff-otp/send-staff-otp.ts';
import { createOtpChannel } from '../persistence/otp-channel.adapter.ts';
import type { OtpExecution, OtpWait } from '../ports/otp-execution.port.ts';

const keys = {
  derivationId: 'synthetic-d',
  verificationId: 'synthetic-v',
  derivation: new Map([['synthetic-d', Buffer.alloc(32, 17)]]),
  verification: new Map([['synthetic-v', Buffer.alloc(32, 29)]]),
};
const identity = createPhoneIdentity('synthetic'.repeat(8), 'synthetic-h');
const capability = { available: () => true, ready: async () => true };
let f: Awaited<ReturnType<typeof otpFixture>>, auth: ReturnType<typeof createStaffOtpExecution>;
beforeAll(async () => {
  f = await otpFixture();
  auth = createStaffOtpExecution({
    databaseUrl: f.test.authUrl,
    configuration: () => ({
      state: 'READY',
      fingerprint: 'synthetic',
      keys,
      templates: { ar: 'synthetic_ar', en: 'synthetic_en' },
      posOrigin: 'https://pos.synthetic.invalid',
    }),
    capability,
    strategies: { identify: identity.identify, phoneLockKey },
  });
  await auth.readiness();
});
afterAll(async () => {
  await auth?.close();
  await f?.close();
});

async function prepared() {
  const base = f.input();
  const challenge = {
    ...base.challenge,
    recipientHash: Buffer.from(identity.identify(phone).hash),
    deviceContext: device,
  };
  const crypto = createOtpCrypto(keys);
  const input = {
    ...base,
    challenge,
    materializeMac: () => crypto.mac(challenge, crypto.derive(challenge)),
  };
  expect(await f.db.prepare(input)).toBe(true);
  return input;
}

function execution(
  ledger: OtpExecution = auth,
  wait: OtpWait = { pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
) {
  const now = () => new Date(),
    fake = new FakeChannel(now);
  const channel = createOtpChannel(
    fake,
    {
      names: { ar: 'synthetic_ar', en: 'synthetic_en' },
      components: {
        ar: [{ type: 'body' }, { type: 'button', sub_type: 'url', index: '0' }],
        en: [{ type: 'body' }, { type: 'button', sub_type: 'url', index: '0' }],
      },
    },
    capability,
    createProviderMessageDigest('synthetic'.repeat(8), 'synthetic-h'),
    now,
  );
  return {
    fake,
    send: new SendStaffOtp(
      ledger,
      capability,
      { reserve: async () => true },
      channel,
      { now },
      { newId: randomUUID },
      wait,
    ),
  };
}

function pauseGate() {
  let release: () => void = () => undefined,
    observed: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    observed = resolve;
  });
  return {
    release,
    waiting,
    pause: async () => {
      observed();
      await held;
    },
  };
}

it('a real PREPARED read releases every transaction before waiting; acknowledged release then delivers once', async () => {
  const p = await prepared(),
    gate = pauseGate();
  const materialize = vi.fn(auth.materialize),
    ledger = { ...auth, materialize };
  const worker = execution(ledger, gate),
    running = worker.send.execute(p.challenge.id, p.attemptId);
  try {
    await Promise.race([
      gate.waiting,
      running.then(() => {
        throw new Error('SYNTHETIC_PREPARED_NOT_OBSERVED');
      }),
    ]);
    expect(materialize).not.toHaveBeenCalled();
    expect(worker.fake.calls).toBe(0);
    expect(
      await f.owner`SELECT state FROM pg_stat_activity WHERE datname=current_database()
      AND usename='pospay_auth' AND state='idle in transaction'`,
    ).toEqual([]);
    expect(
      await f.db.release(p.challenge.id, p.attemptId, p.preparationDeadline, capability.ready),
    ).toBe(true);
  } finally {
    gate.release();
  }
  await running;
  expect(worker.fake.calls).toBe(1);
  expect(await f.db.pending(p.challenge.id, p.attemptId)).toMatchObject({ status: 'SENT' });
  await worker.send.execute(p.challenge.id, p.attemptId);
  expect(worker.fake.calls).toBe(1);
});

it('a lost acknowledgment after a real committed claim permits neither materialization nor duplicate HTTP', async () => {
  const p = await prepared();
  expect(
    await f.db.release(p.challenge.id, p.attemptId, p.preparationDeadline, capability.ready),
  ).toBe(true);
  const materialize = vi.fn(auth.materialize);
  const worker = execution({
    ...auth,
    materialize,
    claim: async (...ids) => {
      expect(await auth.claim(...ids)).toBe(true);
      throw new Error('SYNTHETIC_ACK_LOST');
    },
  });
  await expect(worker.send.execute(p.challenge.id, p.attemptId)).rejects.toThrow(
    'SYNTHETIC_ACK_LOST',
  );
  expect(await f.db.pending(p.challenge.id, p.attemptId)).toMatchObject({ status: 'SENDING' });
  await worker.send.execute(p.challenge.id, p.attemptId);
  expect(materialize).not.toHaveBeenCalled();
  expect(worker.fake.calls).toBe(0);
});

it('provider acceptance followed by result-recording failure never repeats a real fenced execution', async () => {
  const p = await prepared();
  expect(
    await f.db.release(p.challenge.id, p.attemptId, p.preparationDeadline, capability.ready),
  ).toBe(true);
  const worker = execution({
    ...auth,
    finish: async () => {
      throw new Error('SYNTHETIC_RESULT_LOST');
    },
  });
  await expect(worker.send.execute(p.challenge.id, p.attemptId)).rejects.toThrow(
    'SYNTHETIC_RESULT_LOST',
  );
  expect(await f.db.pending(p.challenge.id, p.attemptId)).toMatchObject({ status: 'SENDING' });
  await worker.send.execute(p.challenge.id, p.attemptId);
  expect(worker.fake.calls).toBe(1);
});
