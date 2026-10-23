import type { PushSubscriptionInput } from '@pospay/contracts';
import { describe, expect, it } from 'vitest';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import type { RateLimiter } from '../../../../shared/ports/rate-limiter.port.ts';
import { validAuth, validP256dh } from '../../http/__tests__/push-test-keys.ts';
import type { PushHashes } from '../../ports/push-hashes.port.ts';
import type { PushKeys } from '../../ports/push-keys.port.ts';
import type {
  LivePushSubscription,
  PushSubscriptionStore,
  PushSubscriptionTransactions,
} from '../../ports/push-subscriptions.port.ts';
import { RegisterPushSubscription } from '../register-push-subscription/register-push-subscription.ts';

const SCOPE = { companyId: 'company-1', userId: 'user-1' };
const CONFIG = { keyId: '0123456789abcdef' };

const VALID = { p256dh: validP256dh(), auth: validAuth() };
// نقطة خارج المنحنى: بادئة صحّية بس إحداثياتها مش على المنحنى.
const OFF_CURVE = Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64, 7)]).toString('base64url');
// مفتاح مصادقة أقصر من 16 بايت.
const SHORT_AUTH = Buffer.from(validAuth(), 'base64url').subarray(0, 15).toString('base64url');

const INPUT: PushSubscriptionInput = {
  installation_id: '01920000-0000-4000-8000-0000000000a1',
  vapid_key_id: '0123456789abcdef',
  delivery_token: '01920000-0000-4000-8000-0000000000a2',
  subscription: {
    endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic',
    keys: { p256dh: VALID.p256dh, auth: VALID.auth },
  },
  locale: 'ar',
};

const hashes: PushHashes = {
  installationHash: () => 'install-hash',
  endpointHash: () => 'endpoint-hash',
};
// البورت بيتحقق من المفتاحين زي ما الـ adapter الحقيقي بيعمل: غير المفتاح الصحّ بيرفض.
const keys: PushKeys = {
  validSubscriptionKeys: (p256dh, auth) => p256dh === VALID.p256dh && auth === VALID.auth,
};
const ids: IdGenerator = { newId: () => '01920000-0000-7000-8000-0000000000b1' };
const clock: Clock = { now: () => new Date('2026-10-01T00:00:00.000Z') };

const row = (id: string, over: Partial<LivePushSubscription> = {}): LivePushSubscription => ({
  id,
  userId: 'user-1',
  installationHash: 'install-hash',
  endpointHash: 'endpoint-hash',
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  ...over,
});

interface Read {
  readonly callerRows: readonly LivePushSubscription[];
  readonly holders: readonly LivePushSubscription[];
}

interface Reads {
  readonly first: Read;
  readonly second: Read;
}

interface State {
  transactions: number;
  locked: string[][];
  revokes: number;
  upserts: number;
}

const EMPTY: Read = { callerRows: [], holders: [] };

// معاملة وهمية: بتقرأ صفين (قبل القفل وبعده) وبتسجّل القفل والكتابة.
function transactionsFake(reads: Reads, state: State): PushSubscriptionTransactions {
  let round = 0;
  return {
    run: async (_target, work) => {
      state.transactions += 1;
      const store: PushSubscriptionStore = {
        lockKeys: async (names) => {
          state.locked.push([...names]);
        },
        findCallerLive: async () => {
          round += 1;
          return round === 1 ? reads.first.callerRows : reads.second.callerRows;
        },
        findLiveByEndpoint: async () => (round === 1 ? reads.first.holders : reads.second.holders),
        revoke: async () => {
          state.revokes += 1;
        },
        upsert: async () => {
          state.upserts += 1;
        },
        revokeByInstallation: async () => undefined,
      };
      return work(store);
    },
  };
}

function fakeLimiter(): { limiter: RateLimiter; keys: () => string[] } {
  const keys: string[] = [];
  let hits = 0;
  const limiter: RateLimiter = {
    hit: async (key, limit) => {
      keys.push(key);
      hits += 1;
      return hits <= limit;
    },
    remember: async () => undefined,
    remembered: async () => false,
    count: async () => hits,
    remaining: async () => 0,
  };
  return { limiter, keys: () => keys };
}

function useCase(
  state: State,
  limiter: RateLimiter | null,
  reads: Reads = { first: EMPTY, second: EMPTY },
): RegisterPushSubscription {
  return new RegisterPushSubscription(
    transactionsFake(reads, state),
    hashes,
    keys,
    ids,
    clock,
    limiter,
  );
}

describe('the registration use case', () => {
  it('refuses the twenty-first registration in the window and never opens a transaction', async () => {
    const state: State = { transactions: 0, locked: [], revokes: 0, upserts: 0 };
    const { limiter } = fakeLimiter();
    const register = useCase(state, limiter);
    for (let attempt = 0; attempt < 20; attempt += 1) await register.execute(SCOPE, INPUT, CONFIG);
    await expect(register.execute(SCOPE, INPUT, CONFIG)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    expect(state.transactions).toBe(20);
  });

  it('counts one user once, whatever company she signs in from', async () => {
    const state: State = { transactions: 0, locked: [], revokes: 0, upserts: 0 };
    const { limiter, keys: hits } = fakeLimiter();
    const register = useCase(state, limiter);
    await register.execute(SCOPE, INPUT, CONFIG);
    await register.execute({ ...SCOPE, companyId: 'company-2' }, INPUT, CONFIG);
    expect(hits()).toEqual(['push-subscribe:user-1', 'push-subscribe:user-1']);
  });

  it('is not ready without a limiter, and writes nothing', async () => {
    const state: State = { transactions: 0, locked: [], revokes: 0, upserts: 0 };
    const register = useCase(state, null);
    await expect(register.execute(SCOPE, INPUT, CONFIG)).rejects.toMatchObject({
      code: 'NOT_READY',
    });
    expect(state.transactions).toBe(0);
    expect(state.upserts).toBe(0);
  });
});

describe('the keys of the subscription', () => {
  it('refuses keys the sender cannot encrypt with, and never touches the store', async () => {
    const state: State = { transactions: 0, locked: [], revokes: 0, upserts: 0 };
    const { limiter, keys: hits } = fakeLimiter();
    const register = useCase(state, limiter);
    for (const invalid of [
      { p256dh: OFF_CURVE, auth: VALID.auth },
      { p256dh: VALID.p256dh, auth: SHORT_AUTH },
    ])
      await expect(
        register.execute(
          SCOPE,
          { ...INPUT, subscription: { ...INPUT.subscription, keys: invalid } },
          CONFIG,
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(state.transactions).toBe(0);
    expect(state.upserts).toBe(0);
    expect(hits()).toEqual([]);
  });
});

describe('the registration guards', () => {
  it('is not ready without a push configuration', async () => {
    const state: State = { transactions: 0, locked: [], revokes: 0, upserts: 0 };
    const register = useCase(state, fakeLimiter().limiter);
    await expect(register.execute(SCOPE, INPUT, null)).rejects.toMatchObject({
      code: 'NOT_READY',
    });
    expect(state.transactions).toBe(0);
  });

  it('refuses a registration made under another key and stores nothing', async () => {
    const state: State = { transactions: 0, locked: [], revokes: 0, upserts: 0 };
    const register = useCase(state, fakeLimiter().limiter);
    await expect(
      register.execute(SCOPE, { ...INPUT, vapid_key_id: 'fedcba9876543210' }, CONFIG),
    ).rejects.toMatchObject({ code: 'PUSH_KEY_STALE' });
    expect(state.transactions).toBe(0);
  });

  it('locks the caller and the endpoint once, in one call', async () => {
    const state: State = { transactions: 0, locked: [], revokes: 0, upserts: 0 };
    const register = useCase(state, fakeLimiter().limiter);
    await register.execute(SCOPE, INPUT, CONFIG);
    const locked = state.locked[0] ?? [];
    expect(state.locked).toHaveLength(1);
    expect([...locked].sort()).toEqual(['endpoint:endpoint-hash', 'user:user-1']);
    expect(state.upserts).toBe(1);
  });

  it('refuses when the second read shows a holder that was not in the locked set', async () => {
    const state: State = { transactions: 0, locked: [], revokes: 0, upserts: 0 };
    const holder = row('held', { userId: 'user-2' });
    const reads: Reads = { first: EMPTY, second: { callerRows: [], holders: [holder] } };
    const register = useCase(state, fakeLimiter().limiter, reads);
    await expect(register.execute(SCOPE, INPUT, CONFIG)).rejects.toMatchObject({
      code: 'PUSH_REGISTRATION_BUSY',
    });
    expect(state.upserts).toBe(0);
    expect(state.revokes).toBe(0);
  });
});
