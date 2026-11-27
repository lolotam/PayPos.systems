import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStaffOtpExecution } from './execution.ts';
import type { EmailOtpConfiguration } from '../password-reset-otp/configuration.ts';
import type { OtpConfiguration } from './configuration.ts';

type Ready = (channel: 'EMAIL' | 'WHATSAPP') => Promise<boolean>;

const db = vi.hoisted(() => ({
  state: { open: false },
  claim: vi.fn(),
  materialize: vi.fn(),
  pending: vi.fn(),
  timeout: vi.fn(),
  finish: vi.fn(),
  reconcileAuthAttempt: vi.fn(),
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
const emailReady: EmailOtpConfiguration = { state: 'READY', keys, fingerprint: 'synthetic' };
const whatsappOff: OtpConfiguration = { state: 'DISABLED', reason: 'x' } as OtpConfiguration;

function build(probe: () => Promise<boolean>) {
  return createStaffOtpExecution({
    databaseUrl: 'synthetic',
    configuration: () => whatsappOff,
    emailConfiguration: () => emailReady,
    capability: { ready: vi.fn(async () => false) },
    emailCapability: { ready: vi.fn(probe) },
    strategies: {
      identify: vi.fn(),
      phoneLockKey: () => 1n,
      identifyEmail: vi.fn(() => ({ hash: Buffer.alloc(32, 7), hashKeyId: 'h', valid: true })),
    } as never,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  db.state.open = false;
  // يحاكي المعاملة: open بيفضل true طول ما الحجز شغال ممسك قفل المستلم.
  db.claim.mockImplementation(
    async (_challenge: string, _attempt: string, _execution: string, ready: Ready) => {
      db.state.open = true;
      try {
        return await ready('EMAIL');
      } finally {
        db.state.open = false;
      }
    },
  );
});

describe('claiming an attempt', () => {
  it('runs the full readiness probe before the claim transaction, never inside it', async () => {
    let probedInsideClaim = false;
    const execution = build(async () => {
      probedInsideClaim ||= db.state.open;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return true;
    });
    expect(await execution.claim('c', 'a', 'e')).toBe(true);
    expect(probedInsideClaim).toBe(false);
  });

  it('does not open the claim transaction when no channel is ready', async () => {
    const execution = build(async () => false);
    expect(await execution.claim('c', 'a', 'e')).toBe(false);
    expect(db.claim).not.toHaveBeenCalled();
  });
});

describe('materializing an attempt', () => {
  const found = {
    channel: 'EMAIL' as const,
    destination: 'owner@example.invalid',
    challenge: { hashKeyId: 'h', recipientHash: Buffer.alloc(32, 7) },
  };

  it('honours a kill switch flipped between claim and materialize', async () => {
    let allowed = true;
    let probes = 0;
    const execution = build(async () => {
      probes += 1;
      return allowed;
    });
    expect(await execution.claim('c', 'a', 'e')).toBe(true);
    allowed = false;
    db.materialize.mockResolvedValue(found);
    expect(await execution.materialize('c', 'a', 'e')).toBeNull();
    expect(probes).toBe(2);
  });
});
