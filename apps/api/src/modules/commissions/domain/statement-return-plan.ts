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
 * انتقال حالة الكشف: يرجعه إلى DRAFT ويمسح حقائق المراجعة الخمس.
 * حقائق مجال مستقلة عن التخزين؛ المتصل يملك تحويلها إلى أعمدة وقيم كتابة.
 */
export interface CommissionStatementReturnTransition {
  readonly statementId: string;
  readonly status: 'DRAFT';
  readonly review: {
    readonly fingerprint: null;
    readonly statementFingerprint: null;
    readonly actorUserId: null;
    readonly actorMembershipId: null;
    readonly recordedAt: null;
  };
}

/**
 * صف الإرجاع الخاص: يُضاف مرة واحدة ولا يُعدّل بعد ذلك.
 * السبب يعيش في هذا الصف وحده، فلا يصل إلى حدث ولا إلى نص تدقيق ولا إلى سجل.
 */
export interface CommissionStatementReturnRecord {
  readonly statementId: string;
  readonly actorUserId: string;
  readonly actorMembershipId: string;
  readonly reason: string;
  readonly recordedAt: Date;
}

/**
 * قرار الإرجاع: إرجاع مقبول بخطوتين منفصلتين، أو رفض بلا خطة كتابة.
 * انتقال الحالة (transition) لا يحمل سبباً، والسجل الخاص (privateReturn) هو وحده يحمله.
 */
export type CommissionStatementReturnPlan =
  | {
      readonly kind: 'RETURNED';
      readonly transition: CommissionStatementReturnTransition;
      readonly privateReturn: CommissionStatementReturnRecord;
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
    transition: {
      statementId: input.statementId,
      status: 'DRAFT',
      review: {
        fingerprint: null,
        statementFingerprint: null,
        actorUserId: null,
        actorMembershipId: null,
        recordedAt: null,
      },
    },
    privateReturn: {
      statementId: input.statementId,
      actorUserId: input.actorUserId,
      actorMembershipId: input.actorMembershipId,
      reason: input.normalizedReason,
      recordedAt: input.recordedAt,
    },
  };
}
