import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import { nextBindingRevision, PasskeyBindingError } from '../../domain/passkey-binding.ts';
import { decidePasskeyDeviceLock, DeviceLockRefusal } from '../../domain/passkey-device-lock.ts';
import type { AttendanceDeviceRefusals } from '../../ports/attendance-device-refusals.port.ts';
import { rethrowDeviceLockRefusal } from '../clock-attendance/device-lock-refusal.ts';
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
    private readonly refusals: AttendanceDeviceRefusals,
  ) {}

  /** لا نستبدل ربطاً قائماً حتى مع إثبات WebAuthn صحيح. */
  async execute(
    scope: PasskeyScope,
    challengeId: string,
    response: RegistrationEvidence,
    installationId?: string,
  ) {
    const passkeyId = await this.registration.enroll(scope, challengeId, response);
    if (passkeyId === null) throw new PasskeyBindingError('PASSKEY_INVALID');
    return this.transactions
      .run(scope, async (binding) => {
        const at = this.clock.now();
        if (installationId !== undefined) {
          const decision = decidePasskeyDeviceLock({
            ...(await binding.deviceLock(installationId)),
            step: 'ENROL',
          });
          if (decision.kind === 'REFUSE') throw new DeviceLockRefusal(decision, at);
        }
        const history = await binding.history();
        const revision = nextBindingRevision(history.active, history.revision);
        const record = {
          id: this.ids.newId(),
          passkeyId,
          revision,
          at,
          installationId: installationId ?? null,
        };
        await binding.insert(record);
        return { bound: true, binding_id: record.id, revision, bound_at: record.at.toISOString() };
      })
      .catch((error: unknown) =>
        rethrowDeviceLockRefusal(error, this.refusals, {
          ...scope,
          branchId: null,
          step: 'ENROL',
          installationId: installationId ?? '',
        }),
      );
  }

  /** يرفض الهاتف قبل بدء مراسم التسجيل، ويعيد الفحص عند حفظ الربط. */
  async checkInstallation(scope: PasskeyScope, installationId: string): Promise<void> {
    const at = this.clock.now();
    const facts = await this.transactions.deviceLock(scope, installationId);
    const decision = decidePasskeyDeviceLock({ ...facts, step: 'ENROL' });
    if (decision.kind === 'REFUSE')
      await rethrowDeviceLockRefusal(new DeviceLockRefusal(decision, at), this.refusals, {
        ...scope,
        branchId: null,
        step: 'ENROL',
        installationId,
      });
  }
}

export { PasskeyBindingError } from '../../domain/passkey-binding.ts';
export type { PasskeyScope } from '../../ports/passkeys.port.ts';
