import type { CommissionStatementStatus } from './plan-periods.ts';
import { CommissionPlanVersionError } from './errors.ts';

/** أقصى طول لسبب الإرجاع بالأحرف (code points)، نفس حدّ CHECK القاعدة في سطر الإرجاع (FR-031). */
const RETURN_REASON_MAX_LENGTH = 500;

/**
 * يطبّع سبب إرجاع الكشف ويفرض قاعدته (FR-031): قصّ الفراغات، ثم من حرف إلى 500 حرف (code points،
 * بنفس عدّ `char_length` في CHECK القاعدة)، ولا يقبل أي محرف NUL لأن عمود النص في PostgreSQL
 * ما بيقدرش يخزّنه فكان هيكسر الكتابة بخطأ غير متوقع. أي سبب فارغ بعد القص أو أطول من الحدّ
 * أو فيه NUL بيُرفض بـ COMMISSION_RETURN_REASON_INVALID قبل أي قفل، فلا تُكتب أي حقيقة.
 *
 * @param reason السبب كما وصل من الطلب
 * @returns السبب بعد القصّ
 */
export function normalizeStatementReturnReason(reason: string): string {
  const trimmed = reason.trim();
  const length = Array.from(trimmed).length;
  if (length < 1 || length > RETURN_REASON_MAX_LENGTH || trimmed.includes('\0')) {
    throw new CommissionPlanVersionError('COMMISSION_RETURN_REASON_INVALID');
  }
  return trimmed;
}

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
 * حقائق الإرجاع الخاص: يحفظها المتصل مرة واحدة ولا يعدّل السجل بعد ذلك.
 * السبب يعيش في هذه الحقائق وحدها، فلا يصل إلى حدث ولا إلى نص تدقيق ولا إلى سجل تشغيلي.
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
 * الإرجاع مسموح لحالة REVIEWED وحدها: تعيد الحالة إلى DRAFT وتمسح حقائق المراجعة الخمس،
 * وتحمل السبب في privateReturn وحده لحفظه مرة واحدة؛ وأي حالة أخرى تُرفض بلا انتقال.
 * شرط مسبق: المتصل تحقّق من السبب (مقصوص، من حرف إلى 500) وطبّعه قبل هذه الدالة.
 * هذه الدالة لا تتحقق من الطلب ولا من الصلاحية ولا من القفل ولا من التفرّد ولا من الذرّية،
 * والمتصل يملك القفل والتحويل إلى التخزين وتغيير الحالة الذرّي وحفظ الإرجاع والتدقيق؛
 * وإرجاع الخطة لا يثبت أياً من هذه الالتزامات.
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
