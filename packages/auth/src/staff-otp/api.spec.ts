import { present } from '../../../db/test/present.ts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStaffOtpApi, type StaffOtpApiOptions } from './api.ts';
import type { OtpConfiguration } from './configuration.ts';
import { createOtpCrypto } from './crypto.ts';
import { StaffProofChanged } from '../staff-sessions.ts';

const db = vi.hoisted(() => ({
  lookup: vi.fn(),
  prepare: vi.fn(),
  release: vi.fn(),
  failPreparation: vi.fn(),
  find: vi.fn(),
  consume: vi.fn(),
  mappingValid: vi.fn(),
  ping: vi.fn(),
  close: vi.fn(),
}));
vi.mock('@pospay/db', () => ({ createStaffOtpDatabase: () => db }));
const context = {
  companyId: 'company',
  businessId: 'business',
  branchId: 'branch',
  deviceId: 'device',
};
const keys = {
  derivationId: 'd',
  verificationId: 'v',
  derivation: new Map([['d', Buffer.alloc(32, 17)]]),
  verification: new Map([['v', Buffer.alloc(32, 29)]]),
};
const ready: OtpConfiguration = {
  state: 'READY',
  keys,
  fingerprint: 'synthetic',
  templates: { ar: 'synthetic_ar', en: 'synthetic_en' },
  posOrigin: 'https://pos.synthetic.invalid',
};

function fixture(configuration: OtpConfiguration = ready) {
  let ids = 0;
  const options: StaffOtpApiOptions = {
    databaseUrl: 'synthetic',
    configuration: () => configuration,
    capability: { ready: vi.fn(async () => true) },
    rates: { request: vi.fn(async () => 0), verify: vi.fn(async () => 0) },
    sender: { enqueue: vi.fn(async () => undefined) },
    strategies: {
      identify: vi.fn(() => ({ hash: Buffer.alloc(32, 7), hashKeyId: 'h', valid: true })),
      phoneLockKey: () => 1n,
    },
    eligibility: { eligible: vi.fn(async () => true), deviceValid: vi.fn(async () => true) },
    sessions: {
      ready: vi.fn(async () => undefined),
      candidate: vi.fn(async () => null),
      pinCounterKey: vi.fn(() => 'synthetic-counter'),
      close: vi.fn(async () => undefined),
      issue: vi.fn(async (_user, _device, validate) => {
        if (!(await validate())) throw new StaffProofChanged();
        return {
          session: {
            userId: 'user',
            sessionId: 'session',
            context,
            authenticatedAt: new Date(0),
            deadline: new Date(28_800_000),
          },
          cookie: 'synthetic-cookie',
        };
      }),
      resolve: vi.fn(),
      signOut: vi.fn(),
      normalPurpose: vi.fn(),
    },
    ids: { newId: () => `synthetic-${++ids}` },
    clock: { now: () => new Date(0), waitUntil: vi.fn(async () => undefined) },
    audit: vi.fn(async () => undefined),
  };
  return { options, api: createStaffOtpApi(options) };
}
const request = { phone: '+99900000001', locale: 'ar' as const, ip: '192.0.2.1', device: context };
const verifyInput = {
  challengeId: 'synthetic',
  code: String(7).padStart(6, '0'),
  ip: request.ip,
  device: context,
};
beforeEach(() => {
  vi.resetAllMocks();
  db.lookup.mockResolvedValue('user');
  db.prepare.mockResolvedValue(true);
  db.release.mockResolvedValue(true);
  db.failPreparation.mockResolvedValue(undefined);
  db.mappingValid.mockResolvedValue(true);
});

it('post-creation infrastructure failure is invalid with a bounded diagnostic', async () => {
  const f = fixture();
  const failure = vi.fn();
  const api = createStaffOtpApi({ ...f.options, onFailure: failure });
  db.find.mockResolvedValue({ userId: 'user', recipientHash: Buffer.alloc(32, 7) });
  db.consume.mockResolvedValue('user');
  vi.mocked(f.options.audit).mockRejectedValue(new Error('SYNTHETIC_PRIVATE_DETAIL'));
  expect(
    await api.verify({
      challengeId: 'synthetic-proof',
      code: String(7).padStart(6, '0'),
      ip: request.ip,
      device: context,
    }),
  ).toEqual({ kind: 'invalid' });
  expect(failure).toHaveBeenCalledWith('VERIFY_SESSION', 'OPERATION_FAILED');
  expect(JSON.stringify(failure.mock.calls)).not.toContain('SYNTHETIC_PRIVATE_DETAIL');
});

it('reports capability transitions once and bounds dependency failure diagnostics', async () => {
  const f = fixture();
  const state = vi.fn(),
    failure = vi.fn();
  const api = createStaffOtpApi({ ...f.options, onCapabilityState: state, onFailure: failure });
  vi.mocked(f.options.capability.ready).mockRejectedValueOnce(
    new Error('SYNTHETIC_PRIVATE_DETAIL'),
  );
  expect(await api.request(request)).toEqual({ kind: 'unavailable' });
  expect(failure).toHaveBeenCalledWith('CAPABILITY', 'OPERATION_FAILED');
  expect(state).toHaveBeenCalledWith('UNAVAILABLE');
  await api.request(request);
  await api.request(request);
  expect(state.mock.calls).toEqual([['UNAVAILABLE'], ['READY']]);
  expect(JSON.stringify(failure.mock.calls)).not.toContain('SYNTHETIC_PRIVATE_DETAIL');
});

it.each(['DISABLED', 'UNAVAILABLE'] as const)(
  'refuses %s before all identity work',
  async (state) => {
    const f = fixture({ state, reason: 'synthetic' });
    for (const phone of [request.phone, '+99900000002'])
      expect(await f.api.request({ ...request, phone })).toEqual({ kind: 'unavailable' });
    expect(db.lookup).not.toHaveBeenCalled();
    expect(db.prepare).not.toHaveBeenCalled();
    expect(f.options.sender.enqueue).not.toHaveBeenCalled();
    expect(f.options.strategies.identify).not.toHaveBeenCalled();
  },
);
it('common capability and Redis failures refuse before lookup', async () => {
  const f = fixture();
  vi.mocked(f.options.capability.ready).mockResolvedValueOnce(false);
  expect(await f.api.request(request)).toEqual({ kind: 'unavailable' });
  vi.mocked(f.options.rates.request).mockRejectedValueOnce(new Error('synthetic'));
  expect(await f.api.request(request)).toEqual({ kind: 'unavailable' });
  expect(db.lookup).not.toHaveBeenCalled();
});
it.each([
  'eligible',
  'unknown',
  'nonmember',
  'suppressed',
  'lookup',
  'prepare',
  'enqueue',
  'release',
])('uses one 200ms response window for %s', async (outcome) => {
  const f = fixture();
  if (outcome === 'unknown') db.lookup.mockResolvedValue(null);
  if (outcome === 'nonmember') vi.mocked(f.options.eligibility.eligible).mockResolvedValue(false);
  if (outcome === 'suppressed') db.prepare.mockResolvedValue(false);
  if (outcome === 'lookup') db.lookup.mockRejectedValue(new Error('synthetic'));
  if (outcome === 'prepare') db.prepare.mockRejectedValue(new Error('synthetic'));
  if (outcome === 'enqueue')
    vi.mocked(f.options.sender.enqueue).mockRejectedValue(
      new Error('synthetic unknown acknowledgement'),
    );
  if (outcome === 'release') db.release.mockRejectedValue(new Error('synthetic'));
  expect(await f.api.request(request)).toEqual({ kind: 'accepted', challengeId: 'synthetic-1' });
  expect(f.options.clock.waitUntil).toHaveBeenCalledWith(new Date(200));
  if (outcome === 'enqueue') {
    expect(db.release).not.toHaveBeenCalled();
    expect(db.failPreparation).toHaveBeenCalledOnce();
  }
  if (outcome === 'unknown' || outcome === 'nonmember')
    expect(db.prepare).toHaveBeenCalledWith(expect.objectContaining({ eligible: false }));
});
describe('indistinguishable answers and no permission from uncertain operations', () => {
  it.each(['failed', 'unknown'])(
    'burns consumed proof on %s session creation and does not retry issuance',
    async () => {
      const f = fixture();
      db.find.mockResolvedValue({ userId: 'user', recipientHash: Buffer.alloc(32, 7) });
      db.consume.mockResolvedValueOnce('user').mockResolvedValue(null);
      vi.mocked(f.options.sessions.issue).mockRejectedValueOnce(
        new Error('SYNTHETIC_SESSION_UNCERTAIN'),
      );
      const input = {
        challengeId: 'synthetic',
        code: String(7).padStart(6, '0'),
        ip: request.ip,
        device: context,
      };
      expect(await f.api.verify(input)).toEqual({ kind: 'invalid' });
      expect(await f.api.verify(input)).toEqual({ kind: 'invalid' });
      expect(f.options.sessions.issue).toHaveBeenCalledOnce();
      expect(f.options.audit).not.toHaveBeenCalled();
    },
  );
  it('enqueues only the two ids, and release follows acknowledged enqueue', async () => {
    const f = fixture();
    await f.api.request(request);
    expect(f.options.sender.enqueue).toHaveBeenCalledWith(
      { challengeId: 'synthetic-1', attemptId: 'synthetic-2' },
      new Date(200),
    );
    expect(vi.mocked(f.options.sender.enqueue).mock.invocationCallOrder[0]).toBeLessThan(
      present(db.release.mock.invocationCallOrder[0]),
    );
  });
  it('missing and post-resolution failures are generic and cannot create a session', async () => {
    const f = fixture();
    db.find.mockResolvedValue(null);
    const crypto = createOtpCrypto(keys),
      code = String(7).padStart(6, '0');
    crypto.dummy(code);
    const input = { challengeId: 'absent', code, ip: request.ip, device: context };
    expect(await f.api.verify(input)).toEqual({ kind: 'invalid' });
    expect(f.options.rates.verify).toHaveBeenCalledWith(input.challengeId, request.ip);
    db.find.mockRejectedValue(new Error('synthetic'));
    expect(await f.api.verify(input)).toEqual({ kind: 'invalid' });
    expect(f.options.sessions.issue).not.toHaveBeenCalled();
  });
});

it.each(['missing', 'suppressed', 'wrong', 'database'])(
  'pads verify and reserves the public proof handle before identity work: %s',
  async (outcome) => {
    const f = fixture();
    if (outcome === 'database') db.find.mockRejectedValue(new Error('synthetic'));
    else
      db.find.mockResolvedValue(
        outcome === 'missing'
          ? null
          : {
              userId: outcome === 'suppressed' ? null : 'user',
              recipientHash: Buffer.alloc(32, 7),
            },
      );
    db.consume.mockResolvedValue(null);
    const input = {
      challengeId: 'synthetic-proof',
      code: String(7).padStart(6, '0'),
      ip: request.ip,
      device: context,
    };
    expect(await f.api.verify(input)).toEqual({ kind: 'invalid' });
    expect(f.options.rates.verify).toHaveBeenCalledWith(input.challengeId, input.ip);
    expect(vi.mocked(f.options.rates.verify).mock.invocationCallOrder[0]).toBeLessThan(
      present(db.find.mock.invocationCallOrder[0]),
    );
    expect(f.options.clock.waitUntil).toHaveBeenCalledWith(new Date(200));
    expect(db.find).toHaveBeenCalledWith(input.challengeId, new Date(200));
    if (outcome === 'wrong') {
      expect(f.options.eligibility.deviceValid).toHaveBeenCalledWith(context, new Date(200));
      expect(f.options.eligibility.eligible).toHaveBeenCalledWith('user', context, new Date(200));
      expect(db.consume.mock.calls[0]?.at(-1)).toEqual(new Date(200));
    }
  },
);

it.each(['capability', 'rate'] as const)(
  'common verify %s failure refuses before lookup',
  async (stage) => {
    const f = fixture(),
      failure = vi.fn();
    const api = createStaffOtpApi({ ...f.options, onFailure: failure });
    if (stage === 'capability')
      vi.mocked(f.options.capability.ready).mockRejectedValue(new Error('synthetic'));
    else vi.mocked(f.options.rates.verify).mockRejectedValue(new Error('synthetic'));
    expect(await api.verify(verifyInput)).toEqual({ kind: 'unavailable' });
    expect(db.find).not.toHaveBeenCalled();
    expect(failure).toHaveBeenCalledWith(
      stage === 'capability' ? 'CAPABILITY' : 'VERIFY_RATE',
      'OPERATION_FAILED',
    );
  },
);

it.each(['eligibility', 'consume', 'mapping'] as const)(
  'eligible verify %s failure is invalid and diagnosed',
  async (stage) => {
    const f = fixture(),
      failure = vi.fn();
    const api = createStaffOtpApi({ ...f.options, onFailure: failure });
    db.find.mockResolvedValue({ userId: 'user', recipientHash: Buffer.alloc(32, 7) });
    db.consume.mockResolvedValue('user');
    const error = Object.assign(new Error('SYNTHETIC_PRIVATE_DETAIL'), { code: '57014' });
    if (stage === 'eligibility') vi.mocked(f.options.eligibility.eligible).mockRejectedValue(error);
    else if (stage === 'consume') db.consume.mockRejectedValue(error);
    else db.mappingValid.mockRejectedValue(error);
    expect(await api.verify(verifyInput)).toEqual({ kind: 'invalid' });
    expect(failure).toHaveBeenCalledWith(
      stage === 'mapping' ? 'VERIFY_SESSION' : 'VERIFY_PROOF',
      '57014',
    );
    expect(JSON.stringify(failure.mock.calls)).not.toContain('SYNTHETIC_PRIVATE_DETAIL');
    expect(f.options.clock.waitUntil).toHaveBeenCalledWith(new Date(200));
  },
);
