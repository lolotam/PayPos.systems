import type { PushRevokeInput } from '@pospay/contracts';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { PushHashes } from '../../ports/push-hashes.port.ts';
import type { PushSubscriptionTransactions } from '../../ports/push-subscriptions.port.ts';

/** يلغي اشتراك الدفع للموظفة على التثبيت ده بس، والمجهول والغريب بيتردوا بنفس الرد. */
export class RevokePushSubscription {
  constructor(
    private readonly transactions: PushSubscriptionTransactions,
    private readonly hashes: PushHashes,
    private readonly clock: Clock,
  ) {}

  async execute(
    scope: { companyId: string; userId: string },
    input: PushRevokeInput,
  ): Promise<void> {
    const installationHash = this.hashes.installationHash(scope.companyId, input.installation_id);
    await this.transactions.run(scope, async (store) => {
      // قفل صاحب الطلب هو نفسه قفل التسجيل، فالإلغاء والتسجيل لنفس التثبيت ما يبقاش فيهم تسجيل
      // بيرجّع الصف بعد ما الإلغاء مسحه.
      await store.lockKeys([`user:${scope.userId}`]);
      await store.revokeByInstallation(
        scope.userId,
        installationHash,
        'UNSUBSCRIBED',
        this.clock.now(),
      );
    });
  }
}
