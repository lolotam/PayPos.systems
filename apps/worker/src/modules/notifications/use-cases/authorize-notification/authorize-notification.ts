import { authorizationDecision, type NotificationInput } from '../../domain/attempt-status.ts';
import type { AuthorizationRepository } from '../../ports/attempts.repository.ts';
import type { Clock } from '../../ports/clock.port.ts';
import type { IdGenerator } from '../../ports/id-generator.port.ts';
import type { SuppressionGate } from '../../ports/suppression-gate.port.ts';

/** يمنح الإذن الدائم مرة واحدة على معاملة المصدر وتحت قفل الهاتف نفسه. */
export class AuthorizeNotification {
  constructor(
    readonly attempts: AuthorizationRepository,
    readonly suppression: SuppressionGate,
    readonly clock: Clock,
    readonly ids: IdGenerator,
  ) {}

  async execute(input: NotificationInput): Promise<boolean> {
    await this.attempts.lock(input.identity.hash);
    const suppressed = await this.suppression.isSuppressed(input.identity.hash);
    const now = this.clock.now();
    const decision = authorizationDecision(input, now, suppressed);
    return this.attempts.insert(input, decision, this.ids.newId(), this.ids.newId(), now);
  }
}
