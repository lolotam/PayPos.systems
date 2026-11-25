import type { EndMembershipResult } from '@pospay/contracts';

import { ApiError } from '../../../../shared/errors.ts';
import type {
  EndMembershipCommand,
  EndMembershipDependencies,
} from '../../ports/end-membership.port.ts';

// بينهي عضوية واحدة في شركتها بس، وبعد الـ commit بيبطل منح العضوية (best-effort)؛ جلسات الدخول مبتتلمسش.
export class EndMembership {
  constructor(private readonly deps: EndMembershipDependencies) {}

  async execute(command: EndMembershipCommand): Promise<EndMembershipResult> {
    const outcome = await this.deps.transactions.end(command, this.deps.clock.now());
    if ('refusal' in outcome) throw new ApiError(outcome.refusal);
    // الكاش بيتقري من قاعدة البيانات في كل طلب، فتعذّر الإبطال مش سبب نرفض عملية اتسجلت فعلًا.
    await this.deps.invalidator
      .invalidate(command.companyId, command.membershipId)
      .catch(() => undefined);
    return { id: outcome.id, ends_at: outcome.endsAt };
  }
}
