import type {
  CommissionStatementApproveRequest,
  CommissionStatementReturnInput,
  CommissionStatementReviewInput,
  MarkCommissionStatementPaidInput,
} from '@pospay/contracts';
import { payStatement } from './statement-pay-client';
import {
  approveStatement,
  generateStatement,
  returnStatement,
  reviewStatement,
  type StatementScope,
} from './commission-statement-client';
import { isOpenBusinessReading, type StatementReading } from '../model/statement-reading';

/** أمر كتابة على الكشف مع جسمه. */
export type StatementCommand =
  | { kind: 'generate' }
  | { kind: 'review'; body: CommissionStatementReviewInput }
  | { kind: 'return'; body: CommissionStatementReturnInput }
  | { kind: 'approve'; body: CommissionStatementApproveRequest }
  | { kind: 'pay'; body: MarkCommissionStatementPaidInput };

/**
 * طلب التنفيذ: الأمر، وهوية فتحة الحوار اللي طلعته (مفتاح المحاولة بيعيش معاها بس)، والنسخة اللي المستخدم
 * شافها لحظة فتح الحوار.
 */
export interface StatementRequest {
  command: StatementCommand;
  openingId: string;
  seenVersion: string;
}

/** الشاشة والشهر اللي الأمر بيشتغل عليهم. */
export interface StatementTarget {
  scope: StatementScope;
  period: string;
}

/** رفض بشكل رد السيرفر لما النسخة اتغيّرت بين فتح الحوار والتأكيد، من غير ما نبعت أي حاجة. */
export function staleRefusal() {
  return { status: 409, code: 'COMMISSION_FINGERPRINT_STALE' };
}

/** الكشف بعد المراجعة بحسب ردها: بصمتا المراجعة هما اللي السيرفر قبلهم، وما بقاش في تغيّر بعدها. */
function reviewed(cached: StatementReading, result: { reviewed_fingerprint: string; reviewed_statement_fingerprint: string }) {
  if (!isOpenBusinessReading(cached)) return undefined;
  return {
    ...cached,
    status: 'REVIEWED' as const,
    generated: true,
    reviewed_fingerprint: result.reviewed_fingerprint,
    reviewed_statement_fingerprint: result.reviewed_statement_fingerprint,
    changed_since_review: false,
    change_cause: null,
  };
}

/** الكشف بعد الإرجاع للمسودة: حقائق المراجعة اتمسحت. */
function returned(cached: StatementReading) {
  if (!isOpenBusinessReading(cached)) return undefined;
  return {
    ...cached,
    status: 'DRAFT' as const,
    reviewed_fingerprint: null,
    reviewed_statement_fingerprint: null,
    changed_since_review: false,
    change_cause: null,
  };
}

/**
 * ينفّذ الأمر ويرجّع الكشف زي ما بقى بعده من رد الكتابة نفسه، عشان الشاشة ما تستناش قراءة تانية قد تفشل:
 * العمل والاعتماد بيرجّعوا الكشف كله، والمراجعة والإرجاع بيرجّعوا النتيجة بس فبنعدّل الكشف المحفوظ بيها.
 *
 * @param target هوية الشاشة والشهر
 * @param key مفتاح المحاولة
 * @param command الأمر
 * @param cached الكشف المحفوظ وقت الأمر
 * @returns الكشف بعد الأمر، أو undefined لو ما قدرناش نحدده من الرد
 */
export async function executeStatementCommand(
  target: StatementTarget,
  key: string,
  command: StatementCommand,
  cached: StatementReading | undefined,
): Promise<StatementReading | undefined> {
  const { scope, period } = target;
  if (command.kind === 'pay') {
    const payment = await payStatement(target, key, command.body);
    if (cached?.reader_scope !== 'BUSINESS' || !('input_fingerprint' in cached)) return undefined;
    return { ...cached, status: payment.status, payment };
  }
  if (command.kind === 'generate') return generateStatement(scope, period, key);
  if (command.kind === 'approve') return approveStatement(scope, period, key, command.body);
  if (command.kind === 'review') {
    const result = await reviewStatement(scope, period, key, command.body);
    return cached === undefined ? undefined : reviewed(cached, result);
  }
  await returnStatement(scope, period, key, command.body);
  return cached === undefined ? undefined : returned(cached);
}
