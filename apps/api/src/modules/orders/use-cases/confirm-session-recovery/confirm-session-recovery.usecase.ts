import type { SessionRecoveryConfirm, SessionRecoveryConfirmPort } from '../../ports/session-recovery-confirm.port.ts';
import type { Clock, IdGenerator } from '../../ports/service-session-transactions.port.ts';

/** يلغي إثبات المستدعية فقط ويترك الأعمدة الثابتة كما هي. */
export class ConfirmSessionRecoveryUseCase {
  constructor(private readonly port: SessionRecoveryConfirmPort, private readonly ids: IdGenerator, private readonly clock: Clock) {}
  async execute(input: Omit<SessionRecoveryConfirm, 'at' | 'auditId'>): Promise<void> {
    await this.port.confirm({ ...input, at: this.clock.now(), auditId: this.ids.newId() });
  }
}
