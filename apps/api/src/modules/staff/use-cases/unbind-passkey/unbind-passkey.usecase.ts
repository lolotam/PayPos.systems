import type { UnbindPasskeyInput, UnboundPasskey } from '@pospay/contracts';
import { planPasskeyUnbind } from '../../domain/unbind-passkey.ts';
import type {
  ManagerPasskeyScope,
  UnbindPasskeyTransactions,
} from '../../ports/unbind-passkey.port.ts';

/** يفك المدير ربط الموظف تحت الأقفال؛ لا يحذف الاعتماد العالمي. */
export class UnbindPasskeyUseCase {
  constructor(private readonly transactions: UnbindPasskeyTransactions) {}
  async execute(scope: ManagerPasskeyScope, input: UnbindPasskeyInput): Promise<UnboundPasskey> {
    return this.transactions.run(scope, async (transaction) => {
      const change = {
        ...planPasskeyUnbind(transaction.binding, input, transaction.ownBinding),
        at: transaction.now,
      };
      await transaction.save(change);
      return {
        binding_id: input.binding_id,
        revision: change.revision,
        unbound_at: change.at.toISOString(),
      };
    });
  }
}
export { UnbindPasskeyError } from '../../domain/unbind-passkey.ts';
