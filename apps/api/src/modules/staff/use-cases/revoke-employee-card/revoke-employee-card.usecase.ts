import type {
  EmployeeCardIdempotency,
  EmployeeCardRecord,
  EmployeeCardScope,
  EmployeeCardsPort,
} from '../../ports/employee-cards.port.ts';

/** يلغي كارت حضور نشطاً لموظف بعد إثبات الصلاحية داخل نفس المعاملة. */
export class RevokeEmployeeCard {
  constructor(private readonly cards: EmployeeCardsPort) {}
  execute(
    scope: EmployeeCardScope,
    cardId: string,
    idem: EmployeeCardIdempotency,
  ): Promise<EmployeeCardRecord> {
    return this.cards.revoke(scope, cardId, idem);
  }
}
