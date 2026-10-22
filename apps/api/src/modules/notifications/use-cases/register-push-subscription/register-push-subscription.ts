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
      const before = await readRows(store, scope.userId, endpointHash);
      // مفاتيح واحدة وبترتيب واحد: صاحب الطلب والوجهة وأصحاب الوجهة التانيين؛ كده مفيش تسجيلين
      // ياخدوا الأقفال بترتيبين معاكسين، والوجهة الواحدة ليها قفل واحد.
      const keys = new Set<string>([`user:${scope.userId}`, `endpoint:${endpointHash}`]);
      for (const holder of before.holders)
        if (holder.userId !== scope.userId) keys.add(`user:${holder.userId}`);
      await store.lockKeys([...keys]);
      const after = await readRows(store, scope.userId, endpointHash);
      for (const holder of after.holders)
        if (holder.userId !== scope.userId && !keys.has(`user:${holder.userId}`))
          throw new ApiError('PUSH_REGISTRATION_BUSY');
      const plan = planPushRegistration({
        callerUserId: scope.userId,
        installationHash,
        endpointHash,
        cap: CAP,
        callerRows: after.callerRows,
        endpointHolders: after.holders,
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
}

// القراءة الأولى قبل القفل: بتجمع المفاتيح اللي لازم تتقفل. القراءة الثانية بعد القفل: بتقرر.
async function readRows(
  store: PushSubscriptionStore,
  userId: string,
  endpointHash: string,
): Promise<{
  callerRows: readonly LivePushSubscription[];
  holders: readonly LivePushSubscription[];
}> {
  return {
    callerRows: await store.findCallerLive(userId),
    holders: await store.findLiveByEndpoint(endpointHash),
  };
}
