import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStaffPinResetApi, type StaffPinResetApiOptions } from './api.ts';
import { createOtpCrypto } from '../staff-otp/crypto.ts';
import type { OtpConfiguration } from '../staff-otp/configuration.ts';
import type { OtpChallenge } from '../staff-otp/types.ts';

const db = vi.hoisted(() => ({
  lookup: vi.fn(),
  prepareEmailResetChallenge: vi.fn(),
  failPreparation: vi.fn(),
  release: vi.fn(),
  find: vi.fn(),
  verifyStaffPinResetOtp: vi.fn(),
  consumeStaffPinResetOtp: vi.fn(),
  recordStaffPinReset: vi.fn(),
  mappingValid: vi.fn(),
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
const NOW = new Date('2026-11-27T10:00:00Z');
const IP = '192.0.2.1';
const device = { companyId: 'c', businessId: 'b', branchId: 'br', deviceId: 'dv' };
const emailContext = { purpose: 'STAFF_PIN_RESET', ...device, channel: 'EMAIL' } as const;
const closedWhatsapp: OtpConfiguration = { state: 'DISABLED', reason: 'TEMPLATE_NOT_APPROVED' };

function fixture(whatsapp: OtpConfiguration = closedWhatsapp) {
  let ids = 0;
  const waits: Date[] = [];
  const options: StaffPinResetApiOptions = {
    databaseUrl: 'synthetic',
    emailConfiguration: () => ({ state: 'READY', keys, fingerprint: 'synthetic' }),
    whatsappConfiguration: () => whatsapp,
    capability: {
      EMAIL: { ready: vi.fn(async () => true) },
      WHATSAPP: { ready: vi.fn(async () => true) },
    },
    rates: { request: vi.fn(async () => 0), verify: vi.fn(async () => 0) },
    sender: { enqueue: vi.fn(async () => undefined) },
    strategies: {
      identify: vi.fn(() => ({ hash: Buffer.alloc(32, 1), hashKeyId: 'h', valid: true })),
      phoneLockKey: () => 1n,
      identifyEmail: vi.fn((email: string) => ({
        hash: Buffer.alloc(32, email.startsWith('sara') ? 7 : 8),
        hashKeyId: 'h',
        valid: true,
      })),
    },
    eligibility: {
      eligible: vi.fn(async () => true),
      deviceValid: vi.fn(async () => true),
    },
    recovery: { userByEmail: vi.fn(async () => 'user') },
    pins: { hash: vi.fn(async () => 'hashed'), apply: vi.fn(async () => true) },
    ids: { newId: () => `synthetic-${++ids}` },
    clock: {
      now: () => NOW,
      waitUntil: vi.fn(async (deadline: Date) => {
        waits.push(deadline);
      }),
    },
  };
  return { options, waits, api: createStaffPinResetApi(options) };
}

const request = {
  channel: 'EMAIL' as const,
  identifier: 'Sara@Example.invalid',
  locale: 'en' as const,
  ip: IP,
  device,
};

beforeEach(() => {
  vi.resetAllMocks();
  db.prepareEmailResetChallenge.mockResolvedValue('PREPARED');
  db.release.mockResolvedValue(true);
});

describe('requesting a code answers every case the same way', () => {
  const cases: Array<[string, (f: ReturnType<typeof fixture>) => void, 'PREPARED' | 'REFUSED']> = [
    ['an eligible employee', () => undefined, 'PREPARED'],
    [
      'an unknown or ambiguous address',
      (f) => vi.mocked(f.options.recovery.userByEmail).mockResolvedValue(null),
      'REFUSED',
    ],
    [
      'a suspended employee or a membership without the staff login permission',
      (f) => vi.mocked(f.options.eligibility.eligible).mockResolvedValue(false),
      'REFUSED',
    ],
    [
      'a device that is no longer valid',
      (f) => vi.mocked(f.options.eligibility.deviceValid).mockResolvedValue(false),
      'REFUSED',
    ],
  ];

  it.each(cases)('accepts %s with one shape and one fixed wait', async (_n, arrange, prepared) => {
    const f = fixture();
    arrange(f);
    db.prepareEmailResetChallenge.mockResolvedValue(prepared);
    const result = await f.api.request(request);
    expect(result).toEqual({ kind: 'accepted', challengeId: 'synthetic-1' });
    expect(f.waits).toEqual([new Date(NOW.getTime() + 200)]);
    expect(f.options.sender.enqueue).toHaveBeenCalledTimes(prepared === 'PREPARED' ? 1 : 0);
    const call = db.prepareEmailResetChallenge.mock.calls[0]?.[0] as { eligible: boolean };
    expect(call.eligible).toBe(prepared === 'PREPARED');
  });

  it('answers the same when the database throws while preparing', async () => {
    const f = fixture();
    db.prepareEmailResetChallenge.mockRejectedValue(new Error('boom'));
    expect(await f.api.request(request)).toEqual({ kind: 'accepted', challengeId: 'synthetic-1' });
    expect(f.waits).toHaveLength(1);
  });
});

describe('channels are gated on their own', () => {
  it('refuses WhatsApp while its template is not approved, and still serves email', async () => {
    const f = fixture();
    expect(
      await f.api.request({ ...request, channel: 'WHATSAPP', identifier: '+96550000001' }),
    ).toEqual({
      kind: 'unavailable',
    });
    expect(db.prepareEmailResetChallenge).not.toHaveBeenCalled();
    expect(await f.api.request(request)).toMatchObject({ kind: 'accepted' });
    expect(db.prepareEmailResetChallenge).toHaveBeenCalledTimes(1);
  });

  it('serves WhatsApp through the phone lookup once its configuration is ready', async () => {
    const ready: OtpConfiguration = {
      state: 'READY',
      keys,
      fingerprint: 'f',
      templates: { ar: 'pin_ar', en: 'pin_en' },
      posOrigin: 'https://pos.example.invalid',
    };
    const f = fixture(ready);
    db.lookup.mockResolvedValue('user');
    await f.api.request({ ...request, channel: 'WHATSAPP', identifier: '+96550000001' });
    expect(db.lookup).toHaveBeenCalledWith('+96550000001', expect.any(Date));
    expect(db.prepareEmailResetChallenge).toHaveBeenCalledWith(
      expect.objectContaining({
        staffPin: {
          context: { ...emailContext, channel: 'WHATSAPP' },
          providerTemplateName: 'pin_en',
        },
      }),
    );
  });

  it('turns an email request into a challenge bound to this device, hash only', async () => {
    const f = fixture();
    await f.api.request(request);
    const call = db.prepareEmailResetChallenge.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call['staffPin']).toEqual({ context: emailContext, providerTemplateName: null });
    expect(call['userId']).toBe('user');
    expect(JSON.stringify(call)).not.toContain('example.invalid');
    expect(f.options.recovery.userByEmail).toHaveBeenCalledWith(device, 'sara@example.invalid');
  });

  it('reports limits and an unavailable rate store without touching the database', async () => {
    const f = fixture();
    vi.mocked(f.options.rates.request).mockResolvedValueOnce(42);
    expect(await f.api.request(request)).toEqual({ kind: 'limited', retryAfter: 42 });
    vi.mocked(f.options.rates.request).mockRejectedValueOnce(new Error('redis'));
    expect(await f.api.request(request)).toEqual({ kind: 'unavailable' });
    expect(db.prepareEmailResetChallenge).not.toHaveBeenCalled();
  });
});

const input = { challengeId: 'ch', code: '123456', pin: '4821', ip: IP, device };
const recipientHash = Buffer.alloc(32, 7);

function challenge(): OtpChallenge {
  return {
    id: 'ch',
    recipientHash,
    hashKeyId: 'h',
    userId: 'user',
    deviceContext: emailContext,
    codeMac: null,
    derivationKeyId: 'd',
    verificationKeyId: 'v',
    status: 'ACTIVE',
    failedAttempts: 0,
    createdAt: NOW,
    expiresAt: new Date(NOW.getTime() + 600_000),
  };
}

beforeEach(() => {
  db.find.mockResolvedValue(challenge());
  db.verifyStaffPinResetOtp.mockResolvedValue('MATCH');
  db.consumeStaffPinResetOtp.mockResolvedValue({ userId: 'user', recipientHash });
  db.recordStaffPinReset.mockResolvedValue(undefined);
});

describe('setting the new PIN', () => {
  it('verifies, hashes, consumes the code once, then writes the PIN and records the audit', async () => {
    const f = fixture();
    expect(await f.api.reset(input)).toEqual({ kind: 'reset' });
    const order = [
      db.verifyStaffPinResetOtp.mock.invocationCallOrder[0],
      vi.mocked(f.options.pins.hash).mock.invocationCallOrder[0],
      db.consumeStaffPinResetOtp.mock.invocationCallOrder[0],
      vi.mocked(f.options.pins.apply).mock.invocationCallOrder[0],
      db.recordStaffPinReset.mock.invocationCallOrder[0],
    ];
    expect(order).toEqual([...order].sort((a, b) => (a ?? 0) - (b ?? 0)));
    expect(f.options.pins.apply).toHaveBeenCalledWith(
      expect.objectContaining({ device, userId: 'user', hash: 'hashed', channel: 'EMAIL' }),
    );
  });

  it('accepts only the address whose hash opened the challenge', async () => {
    const f = fixture();
    await f.api.reset(input);
    const { emailMatches } = vi.mocked(f.options.pins.apply).mock.calls[0]?.[0] ?? {};
    expect(emailMatches?.('sara@example.invalid')).toBe(true);
    expect(emailMatches?.('other@example.invalid')).toBe(false);
    expect(emailMatches?.(null)).toBe(false);
  });
});

describe('refusing to set the PIN', () => {
  it('refuses a challenge that belongs to another device, a wrong code and a spent code', async () => {
    const f = fixture();
    db.find.mockResolvedValue({
      ...challenge(),
      deviceContext: { ...emailContext, deviceId: 'other-device' },
    });
    db.verifyStaffPinResetOtp.mockResolvedValue('INVALID');
    expect(await f.api.reset(input)).toEqual({ kind: 'invalid' });
    expect(db.consumeStaffPinResetOtp).not.toHaveBeenCalled();
    db.verifyStaffPinResetOtp.mockResolvedValue('MATCH');
    db.consumeStaffPinResetOtp.mockResolvedValue(null);
    expect(await f.api.reset(input)).toEqual({ kind: 'invalid' });
    expect(f.options.pins.apply).not.toHaveBeenCalled();
  });

  it('does not record the audit row or report success when the write is refused', async () => {
    const f = fixture();
    vi.mocked(f.options.pins.apply).mockResolvedValue(false);
    expect(await f.api.reset(input)).toEqual({ kind: 'invalid' });
    expect(db.recordStaffPinReset).not.toHaveBeenCalled();
  });

  it('keeps the code unspent when the employee stopped being eligible', async () => {
    const f = fixture();
    vi.mocked(f.options.eligibility.eligible).mockResolvedValue(false);
    expect(await f.api.reset(input)).toEqual({ kind: 'invalid' });
    expect(db.consumeStaffPinResetOtp).not.toHaveBeenCalled();
  });

  it('refuses an unknown or non-recovery challenge without any verification', async () => {
    const f = fixture();
    db.find.mockResolvedValue(null);
    expect(await f.api.reset(input)).toEqual({ kind: 'invalid' });
    db.find.mockResolvedValue({ ...challenge(), deviceContext: { purpose: 'PASSWORD_RESET' } });
    expect(await f.api.reset(input)).toEqual({ kind: 'invalid' });
    expect(db.verifyStaffPinResetOtp).not.toHaveBeenCalled();
  });

  it('answers a correct code by comparing against the code derived for this challenge', async () => {
    const f = fixture();
    const crypto = createOtpCrypto(keys);
    const live = { ...challenge(), codeMac: null };
    const code = crypto.derive(live);
    const mac = crypto.mac(live, code);
    db.verifyStaffPinResetOtp.mockImplementation(
      async (_id: string, _device: unknown, compare: (c: OtpChallenge) => boolean) =>
        compare({ ...live, codeMac: mac }) ? 'MATCH' : 'INVALID',
    );
    expect(await f.api.reset({ ...input, code })).toEqual({ kind: 'reset' });
  });

  it('reports limits before reading anything', async () => {
    const f = fixture();
    vi.mocked(f.options.rates.verify).mockResolvedValueOnce(9);
    expect(await f.api.reset(input)).toEqual({ kind: 'limited', retryAfter: 9 });
    expect(db.find).not.toHaveBeenCalled();
  });
});
