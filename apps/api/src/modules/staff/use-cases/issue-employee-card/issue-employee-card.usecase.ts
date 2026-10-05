import { EmployeeCardError, normalizeCardCode, validCardCode } from '../../domain/employee-card.ts';
import type {
  EmployeeCardIdempotency,
  EmployeeCardRecord,
  EmployeeCardScope,
  EmployeeCardsPort,
} from '../../ports/employee-cards.port.ts';

export { EmployeeCardError } from '../../domain/employee-card.ts';
export type { EmployeeCardRecord } from '../../ports/employee-cards.port.ts';

/** يصدر كارت حضور نشطاً لموظف، ويستبدل النشط السابق في نفس المعاملة. */
export class IssueEmployeeCard {
  constructor(private readonly cards: EmployeeCardsPort) {}
  execute(
    scope: EmployeeCardScope,
    cardCode: string,
    idem: EmployeeCardIdempotency,
  ): Promise<EmployeeCardRecord> {
    // التطبيع قبل التحقق يمنع تخزين مسافات طرفية من ماسح لوحة المفاتيح.
    const code = normalizeCardCode(cardCode);
    if (!validCardCode(code)) throw new EmployeeCardError('BAD_REQUEST');
    return this.cards.issue(scope, code, idem);
  }
}
