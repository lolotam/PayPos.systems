import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import { nextBindingRevision, PasskeyBindingError } from '../../domain/passkey-binding.ts';
import type {
  PasskeyRegistration,
  PasskeyScope,
  PasskeyTransactions,
  RegistrationEvidence,
} from '../../ports/passkeys.port.ts';

/** التسجيل العالمي يسبق ربط الشركة؛ اعتماد بلا ربط يظل خاملاً عند فشل المعاملة. */
export class EnrolPasskey {
  constructor(
    private readonly registration: PasskeyRegistration,
    private readonly transactions: PasskeyTransactions,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  /** لا نستبدل ربطاً قائماً حتى مع إثبات WebAuthn صحيح. */
  async execute(scope: PasskeyScope, challengeId: string, response: RegistrationEvidence) {
    const passkeyId = await this.registration.enroll(scope, challengeId, response);
    if (passkeyId === null) throw new PasskeyBindingError('PASSKEY_INVALID');
    return this.transactions.run(scope, async (binding) => {
      const history = await binding.history();
      const revision = nextBindingRevision(history.active, history.revision);
      const record = { id: this.ids.newId(), passkeyId, revision, at: this.clock.now() };
      await binding.insert(record);
      return { bound: true, binding_id: record.id, revision, bound_at: record.at.toISOString() };
    });
  }
}

export { PasskeyBindingError } from '../../domain/passkey-binding.ts';
export type { PasskeyScope } from '../../ports/passkeys.port.ts';
