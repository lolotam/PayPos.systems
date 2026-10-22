import type { PushSubscriptionInput } from '@pospay/contracts';
import { describe, expect, it } from 'vitest';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import type { RateLimiter } from '../../../../shared/ports/rate-limiter.port.ts';
import type { PushHashes } from '../../ports/push-hashes.port.ts';
import type {
  LivePushSubscription,
  PushSubscriptionStore,
  PushSubscriptionTransactions,
} from '../../ports/push-subscriptions.port.ts';
import { RegisterPushSubscription } from '../register-push-subscription/register-push-subscription.ts';

const SCOPE = { companyId: 'company-1', userId: 'user-1' };
const CONFIG = { keyId: '0123456789abcdef' };
const INPUT: PushSubscriptionInput = {
  installation_id: '01920000-0000-4000-8000-0000000000a1',
  vapid_key_id: '0123456789abcdef',
  delivery_token: '01920000-0000-4000-8000-0000000000a2',
  subscription: {
    endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic',
    keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) },
  },
  locale: 'ar',
};

const hashes: PushHashes = {
  installationHash: () => 'install-hash',
  endpointHash: () => 'endpoint-hash',
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
        lockKeys: async (keys) => {
          state.locked.push([...keys]);
        },
        findCallerLive: async () => {
          round += 1;
          return round === 1 ? reads.first.callerRows : reads.second.callerRows;
        },
        findLiveByEndpoint: async () =>
          round === 1 ? reads.first.holders : reads.second.holders,
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

function fakeLimiter(): { limiter: RateLimiter; hits: () => number } {
  let hits = 0;
  const limiter: RateLimiter = {
    hit: async (_key, limit) => {
      hits += 1;
      return hits <= limit;
    },
    remember: async () => undefined,
    remembered: async () => false,
    count: async () => hits,
    remaining: async () => 0,
  };
  return { limiter, hits: () => hits };
}

function useCase(
  state: State,
  limiter: RateLimiter | null,
  reads: Reads = { first: EMPTY, second: EMPTY },
): RegisterPushSubscription {
  return new RegisterPushSubscription(
    transactionsFake(reads, state),
    hashes,
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
    for (let attempt = 0; attempt < 20; attempt += 1)
      await register.execute(SCOPE, INPUT, CONFIG);
    await expect(register.execute(SCOPE, INPUT, CONFIG)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    expect(state.transactions).toBe(20);
  });

  it('skips the limit when there is no limiter', async () => {
    const state: State = { transactions: 0, locked: [], revokes: 0, upserts: 0 };
    const register = useCase(state, null);
    for (let attempt = 0; attempt < 25; attempt += 1)
      await register.execute(SCOPE, INPUT, CONFIG);
    expect(state.transactions).toBe(25);
  });

  it('is not ready without a push configuration', async () => {
    const state: State = { transactions: 0, locked: [], revokes: 0, upserts: 0 };
    const register = useCase(state, null);
    await expect(register.execute(SCOPE, INPUT, null)).rejects.toMatchObject({
      code: 'NOT_READY',
    });
    expect(state.transactions).toBe(0);
  });

  it('refuses a registration made under another key and stores nothing', async () => {
    const state: State = { transactions: 0, locked: [], revokes: 0, upserts: 0 };
    const register = useCase(state, null);
    await expect(
      register.execute(SCOPE, { ...INPUT, vapid_key_id: 'fedcba9876543210' }, CONFIG),
    ).rejects.toMatchObject({ code: 'PUSH_KEY_STALE' });
    expect(state.transactions).toBe(0);
  });

  it('locks the caller and the endpoint once, in one call', async () => {
    const state: State = { transactions: 0, locked: [], revokes: 0, upserts: 0 };
    const register = useCase(state, null);
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
    const register = useCase(state, null, reads);
    await expect(register.execute(SCOPE, INPUT, CONFIG)).rejects.toMatchObject({
      code: 'PUSH_REGISTRATION_BUSY',
    });
    expect(state.upserts).toBe(0);
    expect(state.revokes).toBe(0);
  });
});
