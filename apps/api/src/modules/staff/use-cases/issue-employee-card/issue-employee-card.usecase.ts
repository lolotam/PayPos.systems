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
export { EMPLOYEE_CARD_ACCESS } from '../../ports/employee-card-access.port.ts';
export { CardIssueAttemptsUnavailableError };

/** تجاوز حد محاولات الإصدار؛ طبقة HTTP ترجعه 429 مع الثواني الباقية في الشباك، دون كتابة كارت. */
export class CardIssueLimitedError extends Error {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super('CARD_ISSUE_LIMITED');
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** يبلّغ جذر التركيب أن علامة الاكتمال لم تُحفظ بعد كتابة الكارت. لا يحمل الكود. */
export type CardIssueCompletionWarning = (companyId: string, userId: string) => void;

/** يصدر كارت حضور نشطاً لموظف، بعد احتساب المحاولة، ويستبدل النشط السابق في نفس المعاملة. */
export class IssueEmployeeCard {
  constructor(
    private readonly cards: EmployeeCardsPort,
    private readonly attempts: CardIssueAttempts,
    private readonly warn: CardIssueCompletionWarning,
  ) {}
  async execute(
    scope: EmployeeCardScope,
    cardCode: string,
    idem: EmployeeCardIdempotency,
  ): Promise<EmployeeCardRecord> {
    // التطبيع قبل التحقق يمنع تخزين مسافات طرفية من ماسح لوحة المفاتيح.
    const code = normalizeCardCode(cardCode);
    // نفس المفتاح والبصمة المخزّنة تُعاد قبل العدّ، حتى لو ضاع مؤشر Redis عند سقف الساعة.
    const stored = await this.cards.completedIssue(scope, idem);
    if (stored !== null) return stored;
    const decision = await this.attempts.take(
      scope.companyId,
      scope.operatorId,
      idem.key,
      idem.fingerprint,
    );
    if (decision.outcome === 'limited') {
      throw new CardIssueLimitedError(decision.retryAfterSeconds);
    }
    // إعادة المفتاح المكتمل بنفس البصمة لا تعيد التحقق؛ الجسم المختلف يُحتسب ويُرفض لاحقاً.
    if (decision.outcome === 'accepted' && !validCardCode(code)) {
      throw new EmployeeCardError('BAD_REQUEST');
    }
    const record = await this.cards.issue(scope, code, idem);
    if (decision.outcome === 'accepted') await this.markCompleted(scope, idem);
    return record;
  }

  private async markCompleted(
    scope: EmployeeCardScope,
    idem: EmployeeCardIdempotency,
  ): Promise<void> {
    try {
      await this.attempts.complete(scope.companyId, scope.operatorId, idem.key, idem.fingerprint);
    } catch (error) {
      // الكارت مكتوب. 503 هنا يدفع العميل لمفتاح جديد فيُلغى الكارت ويُعاد إصداره.
      if (!(error instanceof CardIssueAttemptsUnavailableError)) throw error;
      this.warn(scope.companyId, scope.operatorId);
    }
  }
}
