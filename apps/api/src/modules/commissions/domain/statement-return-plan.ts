import type { CommissionStatementStatus } from './plan-periods.ts';

/**
 * حقائق مدخل خطة الإرجاع، يسلّمها المتصل بعد التحقق والقفل.
 * السبب فيها مُطبَّع سلفاً: الدالة لا تقصّه ولا تتحقق من طوله.
 */
export interface CommissionStatementReturnInput {
  readonly statementId: string;
  readonly status: CommissionStatementStatus;
  readonly actorUserId: string;
  readonly actorMembershipId: string;
  readonly recordedAt: Date;
  readonly normalizedReason: string;
}

/**
 * تغيير حالة الكشف: يرجعه إلى DRAFT ويمسح كل أعمدة المراجعة.
 * أسماء الحقول هي أسماء أعمدة جدول commission_statements، وكل قيمها null.
 */
export interface CommissionStatementReturnStateUpdate {
  readonly statement_id: string;
  readonly status: 'DRAFT';
  readonly reviewed_fingerprint: null;
  readonly reviewed_statement_fingerprint: null;
  readonly reviewed_by: null;
  readonly reviewed_membership_id: null;
  readonly reviewed_at: null;
}

/**
 * صف الإرجاع الخاص: يُضاف مرة واحدة ولا يُعدّل بعد ذلك.
 * السبب يعيش في هذا الصف وحده، فلا يصل إلى حدث ولا إلى نص تدقيق ولا إلى سجل.
 */
export interface CommissionStatementReturnRecord {
  readonly statement_id: string;
  readonly returned_by: string;
  readonly returned_membership_id: string;
  readonly reason: string;
  readonly returned_at: Date;
}

/**
 * قرار الإرجاع: إرجاع مقبول بخطوتين منفصلتين، أو رفض بلا خطة كتابة.
 * خطوة الحالة (state_update) لا تحمل سبباً، وخطوة السجل الخاص (return_record) هي وحدها تحمله.
 */
export type CommissionStatementReturnPlan =
  | {
      readonly kind: 'RETURNED';
      readonly state_update: CommissionStatementReturnStateUpdate;
      readonly return_record: CommissionStatementReturnRecord;
    }
  | {
      readonly kind: 'NOT_REVIEWED';
      readonly status: CommissionStatementStatus;
    };

/**
 * يبني خطة إرجاع كشف مُراجَع إلى DRAFT (FR-031).
 * الإرجاع مسموح لحالة REVIEWED وحدها: تعيد الحالة إلى DRAFT وتمسح كل أعمدة reviewed_*،
 * وتضع السبب في صف إرجاع خاص يُضاف مرة واحدة؛ وأي حالة أخرى تُرفض بلا خطة كتابة.
 * شرط مسبق: المتصل تحقّق من السبب (مقصوص، من حرف إلى 500) وطبّعه قبل هذه الدالة.
 * هذه الدالة لا تتحقق من الطلب ولا من الصلاحية ولا من القفل ولا من التفرّد ولا من الذرّية،
 * والمتصل هو صاحب القفل وتغيير الحالة الذرّي وإضافة الصف والتدقيق؛ وإرجاع الخطة لا يثبت أياً منها.
 *
 * @param input حقائق الكشف والفاعل ووقت التسجيل والسبب المُطبَّع
 * @returns خطة إرجاع بخطوتين، أو رفض NOT_REVIEWED بلا خطة كتابة
 */
export function planCommissionStatementReturn(
  input: CommissionStatementReturnInput,
): CommissionStatementReturnPlan {
  if (input.status !== 'REVIEWED') {
    return { kind: 'NOT_REVIEWED', status: input.status };
  }
  return {
    kind: 'RETURNED',
    state_update: {
      statement_id: input.statementId,
      status: 'DRAFT',
      reviewed_fingerprint: null,
      reviewed_statement_fingerprint: null,
      reviewed_by: null,
      reviewed_membership_id: null,
      reviewed_at: null,
    },
    return_record: {
      statement_id: input.statementId,
      returned_by: input.actorUserId,
      returned_membership_id: input.actorMembershipId,
      reason: input.normalizedReason,
      returned_at: input.recordedAt,
    },
  };
}
