import { EmployeeCardError, normalizeCardCode, validCardCode } from '../../domain/employee-card.ts';
import {
  CardIssueAttemptsUnavailableError,
  type CardIssueAttempts,
} from '../../ports/card-issue-attempts.port.ts';
import type {
  EmployeeCardIdempotency,
  EmployeeCardRecord,
  EmployeeCardScope,
  EmployeeCardsPort,
} from '../../ports/employee-cards.port.ts';

export { EmployeeCardError } from '../../domain/employee-card.ts';
export type { EmployeeCardRecord } from '../../ports/employee-cards.port.ts';
export {
  EMPLOYEE_CARD_ACCESS,
  type EmployeeCardAccess,
} from '../../ports/employee-card-access.port.ts';
export { CardIssueAttemptsUnavailableError };

/** تجاوز حد محاولات الإصدار؛ طبقة HTTP ترجعه 429 دون كتابة كارت. */
export class CardIssueLimitedError extends Error {
  constructor() {
    super('CARD_ISSUE_LIMITED');
  }
}

/** يصدر كارت حضور نشطاً لموظف، بعد احتساب المحاولة، ويستبدل النشط السابق في نفس المعاملة. */
export class IssueEmployeeCard {
  constructor(
    private readonly cards: EmployeeCardsPort,
    private readonly attempts: CardIssueAttempts,
  ) {}
  async execute(
    scope: EmployeeCardScope,
    cardCode: string,
    idem: EmployeeCardIdempotency,
  ): Promise<EmployeeCardRecord> {
    // التطبيع قبل التحقق يمنع تخزين مسافات طرفية من ماسح لوحة المفاتيح.
    const code = normalizeCardCode(cardCode);
    const decision = await this.attempts.take(
      scope.companyId,
      scope.operatorId,
      idem.key,
      idem.fingerprint,
    );
    if (decision === 'limited') throw new CardIssueLimitedError();
    // إعادة المفتاح المكتمل بنفس البصمة لا تعيد التحقق؛ الجسم المختلف يُحتسب ويُرفض لاحقاً.
    if (decision === 'accepted' && !validCardCode(code)) throw new EmployeeCardError('BAD_REQUEST');
    const record = await this.cards.issue(scope, code, idem);
    if (decision === 'accepted') {
      await this.attempts.complete(scope.companyId, scope.operatorId, idem.key, idem.fingerprint);
    }
    return record;
  }
}
