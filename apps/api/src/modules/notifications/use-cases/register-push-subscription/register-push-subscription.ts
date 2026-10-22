import type { PushSubscriptionInput } from '@pospay/contracts';

import { ApiError } from '../../../../shared/errors.ts';
import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import type { RateLimiter } from '../../../../shared/ports/rate-limiter.port.ts';
import { planPushRegistration } from '../../domain/push-registration.ts';
import type { PushHashes } from '../../ports/push-hashes.port.ts';
import type {
  LivePushSubscription,
  PushSubscriptionStore,
  PushSubscriptionTransactions,
} from '../../ports/push-subscriptions.port.ts';

const CAP = 5;
const LIMIT = 20;
const WINDOW_SECONDS = 3600;

/** يسجّل اشتراك الدفع للموظفة على تثبيتها، ويسحب القديم لما يتغيّر المالك أو يتجاوز الحد. */
export class RegisterPushSubscription {
  constructor(
    private readonly transactions: PushSubscriptionTransactions,
    private readonly hashes: PushHashes,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly rateLimiter: RateLimiter | null,
  ) {}

  async execute(
    scope: { companyId: string; userId: string },
    input: PushSubscriptionInput,
    config: { readonly keyId: string } | null,
  ): Promise<void> {
    if (config === null) throw new ApiError('NOT_READY');
    if (input.vapid_key_id !== config.keyId) throw new ApiError('PUSH_KEY_STALE');
    if (this.rateLimiter !== null) {
      const allowed = await this.rateLimiter.hit(
        `push-subscribe:${scope.companyId}:${scope.userId}`,
        LIMIT,
        WINDOW_SECONDS,
      );
      if (!allowed) throw new ApiError('RATE_LIMITED');
    }
    await this.transactions.run(scope, async (store) => {
      const installationHash = this.hashes.installationHash(scope.companyId, input.installation_id);
      const endpointHash = this.hashes.endpointHash(input.subscription.endpoint);
      await store.lockUsers([scope.userId]);
      const { callerRows, holders } = await this.readLocked(store, scope, endpointHash);
      const plan = planPushRegistration({
        callerUserId: scope.userId,
        installationHash,
        endpointHash,
        cap: CAP,
        callerRows,
        endpointHolders: holders,
      });
      const now = this.clock.now();
      for (const revocation of plan.revoke)
        await store.revoke(revocation.id, revocation.reason, now);
      await store.upsert({
        id: this.ids.newId(),
        installationHash,
        endpoint: input.subscription.endpoint,
        p256dh: input.subscription.keys.p256dh,
        auth: input.subscription.keys.auth,
        endpointHash,
        deliveryToken: input.delivery_token,
        locale: input.locale,
        vapidKeyId: config.keyId,
        now,
      });
    });
  }

  // القفل الأول على صاحب الطلب بس؛ لو فيه صاحب تاني للوجهة بينقفل الاتنين بترتيب المعرف الصاعد
  // والصفوف بتتقري تاني عشان السحب والعدّ يبانوا على الحالة المقفولة.
  private async readLocked(
    store: PushSubscriptionStore,
    scope: { companyId: string; userId: string },
    endpointHash: string,
  ): Promise<{
    callerRows: readonly LivePushSubscription[];
    holders: readonly LivePushSubscription[];
  }> {
    let callerRows = await store.findCallerLive(scope.userId);
    let holders = await store.findLiveByEndpoint(endpointHash);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const others = holders
        .filter((row) => row.userId !== scope.userId)
        .map((row) => row.userId);
      if (others.length === 0) break;
      await store.lockUsers([...new Set([scope.userId, ...others])].sort());
      callerRows = await store.findCallerLive(scope.userId);
      holders = await store.findLiveByEndpoint(endpointHash);
    }
    return { callerRows, holders };
  }
}
