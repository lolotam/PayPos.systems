import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPasswordResetOtpApi, type PasswordResetOtpApiOptions } from './api.ts';
import type { EmailOtpConfiguration } from './configuration.ts';
import { createOtpCrypto } from '../staff-otp/crypto.ts';
import type { OtpChallenge } from '../staff-otp/types.ts';

const db = vi.hoisted(() => ({
  lookupCredentialUserByEmail: vi.fn(),
  prepareEmailResetChallenge: vi.fn(),
  failPreparation: vi.fn(),
  release: vi.fn(),
  verifyPasswordResetOtp: vi.fn(),
  consumePasswordResetOtp: vi.fn(),
  ping: vi.fn(),
  close: vi.fn(),
}));
vi.mock('@pospay/db', () => ({ createStaffOtpDatabase: () => db }));

const keys = {
  derivationId: 'd',
  verificationId: 'v',
  derivation: new Map([['d', Buffer.alloc(32, 17)]]),
  verification: new Map([['v', Buffer.alloc(32, 29)]]),
};
const ready: EmailOtpConfiguration = { state: 'READY', keys, fingerprint: 'synthetic' };
const IP = '192.0.2.1';
const NOW = new Date('2026-11-26T10:00:00Z');

function fixture(configuration: EmailOtpConfiguration = ready) {
  let ids = 0;
  const waits: Date[] = [];
  const options: PasswordResetOtpApiOptions = {
    databaseUrl: 'synthetic',
    configuration: () => configuration,
    capability: { ready: vi.fn(async () => true) },
    rates: { request: vi.fn(async () => 0), verify: vi.fn(async () => 0) },
    sender: { enqueue: vi.fn(async () => undefined) },
    strategies: {
      identify: vi.fn(() => ({ hash: Buffer.alloc(32, 1), hashKeyId: 'h', valid: false })),
      phoneLockKey: () => 1n,
      identifyEmail: vi.fn(() => ({ hash: Buffer.alloc(32, 7), hashKeyId: 'h', valid: true })),
    },
    ids: { newId: () => `synthetic-${++ids}` },
    clock: {
      now: () => NOW,
      waitUntil: vi.fn(async (deadline: Date) => {
        waits.push(deadline);
      }),
    },
    hasher: { hash: vi.fn(async () => 'synthetic-hash') },
  };
  return { options, waits, api: createPasswordResetOtpApi(options) };
}

const request = { email: 'Owner@Example.invalid', locale: 'en' as const, ip: IP };

beforeEach(() => {
  vi.resetAllMocks();
  db.lookupCredentialUserByEmail.mockResolvedValue({
    id: 'user',
    email: 'owner@example.invalid',
    staffAccessOperationId: null,
  });
  db.prepareEmailResetChallenge.mockResolvedValue('PREPARED');
  db.release.mockResolvedValue(true);
  db.failPreparation.mockResolvedValue(undefined);
});

describe('requesting a code answers every case the same way', () => {
  const cases: Array<[string, () => void, 'PREPARED' | 'REFUSED' | 'SUPPRESSED']> = [
    ['an eligible owner', () => undefined, 'PREPARED'],
    ['an unknown email', () => db.lookupCredentialUserByEmail.mockResolvedValue(null), 'REFUSED'],
    [
      'a staff account',
      () =>
        db.lookupCredentialUserByEmail.mockResolvedValue({
          id: 'staff',
          email: 'owner@example.invalid',
          staffAccessOperationId: 'operation',
        }),
      'REFUSED',
    ],
    [
      'a synthetic staff email',
      () =>
        db.lookupCredentialUserByEmail.mockResolvedValue({
          id: 'staff',
          email: 'staff-0123@staff.pospay.invalid',
          staffAccessOperationId: null,
        }),
      'REFUSED',
    ],
    ['a suppressed email', () => undefined, 'SUPPRESSED'],
  ];

  it.each(cases)(
    'accepts %s with the same shape and the same fixed wait',
    async (_name, arrange, prepared) => {
      arrange();
      db.prepareEmailResetChallenge.mockResolvedValue(prepared);
      const f = fixture();
      const result = await f.api.request(request);
      expect(result).toEqual({ kind: 'accepted', challengeId: 'synthetic-1' });
      expect(f.waits).toEqual([new Date(NOW.getTime() + 200)]);
      expect(f.options.sender.enqueue).toHaveBeenCalledTimes(prepared === 'PREPARED' ? 1 : 0);
    },
  );
});

describe('what a request prepares', () => {
  it('refuses eligibility for staff and unknown accounts before anything is prepared as sendable', async () => {
    db.lookupCredentialUserByEmail.mockResolvedValue({
      id: 'staff',
      email: 'owner@example.invalid',
      staffAccessOperationId: 'operation',
    });
    const f = fixture();
    await f.api.request(request);
    expect(db.prepareEmailResetChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ eligible: false, userId: 'staff' }),
    );
    db.lookupCredentialUserByEmail.mockResolvedValue(null);
    await f.api.request(request);
    expect(db.prepareEmailResetChallenge).toHaveBeenLastCalledWith(
      expect.objectContaining({ eligible: false, userId: null }),
    );
  });

  it('prepares a challenge valid for ten minutes on the lower-cased email', async () => {
    const f = fixture();
    await f.api.request(request);
    expect(f.options.strategies.identifyEmail).toHaveBeenCalledWith('owner@example.invalid');
    expect(db.prepareEmailResetChallenge).toHaveBeenCalledWith(
      expect.objectContaining({
        eligible: true,
        locale: 'en',
        expiresAt: new Date(NOW.getTime() + 600_000),
        preparationDeadline: new Date(NOW.getTime() + 200),
      }),
    );
  });

  it('keeps answering accepted when the queue refuses, and withdraws the preparation', async () => {
    const f = fixture();
    vi.mocked(f.options.sender.enqueue).mockRejectedValue(new Error('OTP_ENQUEUE_UNAVAILABLE'));
    expect(await f.api.request(request)).toEqual({ kind: 'accepted', challengeId: 'synthetic-1' });
    expect(db.failPreparation).toHaveBeenCalledTimes(1);
    expect(db.release).not.toHaveBeenCalled();
  });

  it('keeps answering accepted when the database fails mid-preparation', async () => {
    db.prepareEmailResetChallenge.mockRejectedValue(new Error('OTP_DATABASE_UNAVAILABLE'));
    const f = fixture();
    expect(await f.api.request(request)).toEqual({ kind: 'accepted', challengeId: 'synthetic-1' });
    expect(f.waits).toHaveLength(1);
  });
});

describe('limits and capability decide before any account is read', () => {
  it('answers limited with the retry delay and reads nothing', async () => {
    const f = fixture();
    vi.mocked(f.options.rates.request).mockResolvedValue(42);
    expect(await f.api.request(request)).toEqual({ kind: 'limited', retryAfter: 42 });
    expect(db.lookupCredentialUserByEmail).not.toHaveBeenCalled();
    expect(f.options.capability.ready).not.toHaveBeenCalled();
  });
});

describe('the readiness probe is bounded and comes after the rate limiter', () => {
  it('runs the rate limiter before the readiness probe on both public routes', async () => {
    const f = fixture();
    vi.mocked(f.options.rates.request).mockResolvedValue(5);
    vi.mocked(f.options.rates.verify).mockResolvedValue(5);
    await f.api.request(request);
    await f.api.reset({ challengeId: 'c', code: '123456', newPassword: 'a-new-password', ip: IP });
    expect(f.options.capability.ready).not.toHaveBeenCalled();
  });

  it('bounds the readiness probe by the fixed window on request and reset', async () => {
    const f = fixture();
    db.verifyPasswordResetOtp.mockResolvedValue('INVALID');
    await f.api.request(request);
    await f.api.reset({ challengeId: 'c', code: '123456', newPassword: 'a-new-password', ip: IP });
    const window = new Date(NOW.getTime() + 200);
    expect(vi.mocked(f.options.capability.ready).mock.calls[0]).toEqual([window]);
    expect(vi.mocked(f.options.capability.ready).mock.calls[1]).toEqual([window]);
  });

  it('hands the release step a deadline-bound readiness check, never the unbounded probe', async () => {
    const f = fixture();
    const probes: Array<Date | undefined> = [];
    vi.mocked(f.options.capability.ready).mockImplementation(async (deadline) => {
      probes.push(deadline);
      return true;
    });
    db.release.mockImplementation(async (_c, _a, _deadline, ready: () => Promise<boolean>) =>
      ready(),
    );
    await f.api.request(request);
    const window = new Date(NOW.getTime() + 200);
    expect(probes).toEqual([window, window]);
    expect(probes.every((deadline) => deadline !== undefined)).toBe(true);
  });
});

describe('the preparation never runs a nested probe', () => {
  it('never probes readiness from inside the preparation or the lookup', async () => {
    const f = fixture();
    let inside = 0;
    let nested = 0;
    const around = async <T>(work: T): Promise<T> => {
      inside += 1;
      await new Promise((resolve) => setTimeout(resolve, 1));
      inside -= 1;
      return work;
    };
    vi.mocked(f.options.capability.ready).mockImplementation(async () => {
      if (inside > 0) nested += 1;
      return true;
    });
    db.lookupCredentialUserByEmail.mockImplementation(() =>
      around({ id: 'user', email: 'owner@example.invalid', staffAccessOperationId: null }),
    );
    db.prepareEmailResetChallenge.mockImplementation(() => around('PREPARED'));
    await f.api.request(request);
    expect(nested).toBe(0);
  });

  it('passes the window deadline to the account lookup', async () => {
    const f = fixture();
    await f.api.request(request);
    expect(db.lookupCredentialUserByEmail).toHaveBeenCalledWith(
      'owner@example.invalid',
      new Date(NOW.getTime() + 200),
    );
  });
});

describe('limits and capability on reset', () => {
  it('answers limited on reset before the code is compared', async () => {
    const f = fixture();
    vi.mocked(f.options.rates.verify).mockResolvedValue(9);
    const result = await f.api.reset({
      challengeId: 'c',
      code: '123456',
      newPassword: 'a-new-password',
      ip: IP,
    });
    expect(result).toEqual({ kind: 'limited', retryAfter: 9 });
    expect(db.verifyPasswordResetOtp).not.toHaveBeenCalled();
    expect(f.options.hasher.hash).not.toHaveBeenCalled();
  });

  it.each([
    ['disabled configuration', () => fixture({ state: 'DISABLED', reason: 'x' })],
    ['unavailable configuration', () => fixture({ state: 'UNAVAILABLE', reason: 'x' })],
    [
      'a worker that is not ready',
      () => {
        const f = fixture();
        vi.mocked(f.options.capability.ready).mockResolvedValue(false);
        return f;
      },
    ],
    [
      'a Redis failure',
      () => {
        const f = fixture();
        vi.mocked(f.options.rates.request).mockRejectedValue(new Error('REDIS'));
        vi.mocked(f.options.rates.verify).mockRejectedValue(new Error('REDIS'));
        return f;
      },
    ],
  ])('is unavailable on %s and never touches the database', async (_name, build) => {
    const f = build();
    expect(await f.api.request(request)).toEqual({ kind: 'unavailable' });
    expect(
      await f.api.reset({
        challengeId: 'c',
        code: '123456',
        newPassword: 'a-new-password',
        ip: IP,
      }),
    ).toEqual({ kind: 'unavailable' });
    expect(db.lookupCredentialUserByEmail).not.toHaveBeenCalled();
    expect(db.verifyPasswordResetOtp).not.toHaveBeenCalled();
  });
});

const input = { challengeId: 'c', code: '123456', newPassword: 'a-new-password', ip: IP };
const challenge: OtpChallenge = {
  id: 'c',
  recipientHash: Buffer.alloc(32, 7),
  hashKeyId: 'h',
  userId: 'user',
  deviceContext: { purpose: 'PASSWORD_RESET' },
  codeMac: null,
  derivationKeyId: 'd',
  verificationKeyId: 'v',
  status: 'ACTIVE',
  failedAttempts: 0,
  createdAt: NOW,
  expiresAt: new Date(NOW.getTime() + 600_000),
};

describe('resetting the password with a code', () => {
  it('hashes the password only after the code matched, and reports the reset', async () => {
    const crypto = createOtpCrypto(keys);
    const code = crypto.derive(challenge);
    const active = { ...challenge, codeMac: crypto.mac(challenge, code) };
    db.verifyPasswordResetOtp.mockImplementation(async (_id, compare) =>
      compare(active) ? 'MATCH' : 'INVALID',
    );
    db.consumePasswordResetOtp.mockResolvedValue('RESET');
    const f = fixture();
    expect(await f.api.reset({ ...input, code })).toEqual({ kind: 'reset' });
    expect(f.options.hasher.hash).toHaveBeenCalledWith('a-new-password');
    expect(db.consumePasswordResetOtp).toHaveBeenCalledWith(
      expect.objectContaining({ challengeId: 'c', passwordHash: 'synthetic-hash' }),
    );
  });
});

describe('the reset answers inside one fixed window (SC-003)', () => {
  const window = new Date(NOW.getTime() + 200);
  const active = { ...challenge, codeMac: Buffer.alloc(32, 5) };
  const cases: Array<[string, () => void]> = [
    ['a missing challenge row', () => db.verifyPasswordResetOtp.mockResolvedValue('INVALID')],
    ['a suppressed target', () => db.verifyPasswordResetOtp.mockResolvedValue('INVALID')],
    ['an exhausted challenge', () => db.verifyPasswordResetOtp.mockResolvedValue('EXHAUSTED')],
    [
      'a wrong code on an active row',
      () =>
        db.verifyPasswordResetOtp.mockImplementation(async (_id, compare) =>
          compare(active) ? 'MATCH' : 'INVALID',
        ),
    ],
  ];

  it.each(cases)('waits for the window deadline exactly once on %s', async (_name, arrange) => {
    arrange();
    const f = fixture();
    expect(await f.api.reset(input)).toEqual({ kind: 'invalid' });
    expect(f.waits).toEqual([window]);
    expect(f.options.hasher.hash).not.toHaveBeenCalled();
  });

  it('closes the window before the slow password hashing on a match', async () => {
    db.verifyPasswordResetOtp.mockResolvedValue('MATCH');
    db.consumePasswordResetOtp.mockResolvedValue('RESET');
    const f = fixture();
    let waitsAtHash = -1;
    vi.mocked(f.options.hasher.hash).mockImplementation(async () => {
      waitsAtHash = f.waits.length;
      return 'synthetic-hash';
    });
    expect(await f.api.reset(input)).toEqual({ kind: 'reset' });
    expect(waitsAtHash).toBe(1);
    expect(f.waits).toEqual([window]);
  });

  it('hands the window deadline to the verification', async () => {
    db.verifyPasswordResetOtp.mockResolvedValue('INVALID');
    await fixture().api.reset(input);
    expect(db.verifyPasswordResetOtp).toHaveBeenCalledWith(
      'c',
      expect.any(Function),
      expect.any(String),
      window,
    );
  });

  it('keeps the window when the database fails', async () => {
    db.verifyPasswordResetOtp.mockRejectedValue(new Error('OTP_DATABASE_UNAVAILABLE'));
    const f = fixture();
    expect(await f.api.reset(input)).toEqual({ kind: 'invalid' });
    expect(f.waits).toEqual([window]);
  });
});

describe('refusing a reset', () => {
  it('answers invalid for a wrong code and never hashes the password', async () => {
    db.verifyPasswordResetOtp.mockResolvedValue('INVALID');
    const f = fixture();
    expect(await f.api.reset(input)).toEqual({ kind: 'invalid' });
    expect(f.options.hasher.hash).not.toHaveBeenCalled();
    expect(db.consumePasswordResetOtp).not.toHaveBeenCalled();
  });

  it('answers invalid once the fifth wrong code exhausted the challenge', async () => {
    db.verifyPasswordResetOtp.mockResolvedValue('EXHAUSTED');
    const f = fixture();
    expect(await f.api.reset(input)).toEqual({ kind: 'invalid' });
    expect(f.options.hasher.hash).not.toHaveBeenCalled();
  });

  it('answers invalid when the atomic consume refuses, and when the database fails', async () => {
    db.verifyPasswordResetOtp.mockResolvedValue('MATCH');
    db.consumePasswordResetOtp.mockResolvedValue('INVALID');
    const f = fixture();
    expect(await f.api.reset(input)).toEqual({ kind: 'invalid' });
    db.consumePasswordResetOtp.mockRejectedValue(new Error('OTP_DATABASE_UNAVAILABLE'));
    expect(await f.api.reset(input)).toEqual({ kind: 'invalid' });
  });

  it('lets two parallel resets of one challenge run one after the other', async () => {
    const order: string[] = [];
    db.verifyPasswordResetOtp.mockImplementation(async () => {
      order.push('verify-start');
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push('verify-end');
      return 'MATCH';
    });
    db.consumePasswordResetOtp.mockImplementation(async () => {
      order.push('consume');
      return order.filter((step) => step === 'consume').length === 1 ? 'RESET' : 'INVALID';
    });
    const f = fixture();
    const results = await Promise.all([f.api.reset(input), f.api.reset(input)]);
    expect(results.filter((result) => result.kind === 'reset')).toHaveLength(1);
    expect(order).toEqual([
      'verify-start',
      'verify-end',
      'consume',
      'verify-start',
      'verify-end',
      'consume',
    ]);
  });
});
