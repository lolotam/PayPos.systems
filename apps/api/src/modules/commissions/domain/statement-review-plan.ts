import type { CommissionStatementStatus } from './plan-periods.ts';
import { statementChangeCause, type StatementChangeCause } from './statement-change-cause.ts';

/** كود المشكلة اللي بتمنع المراجعة: موظفة من غير خطة أو من غير مرتب. */
export type CommissionStatementBlockingCode = 'NO_PLAN' | 'NO_SALARY';

/** مشكلة بتمنع المراجعة (FR-027، FR-048): موظفة وكود سبب التوقف. */
export interface CommissionStatementBlockingIssue {
  readonly employeeId: string;
  readonly code: CommissionStatementBlockingCode;
}

/** حقائق المراجعة، يسلّمها المتصل بعد القفل وإعادة الفحص. */
export interface CommissionStatementReviewInput {
  readonly statementId: string;
  readonly status: CommissionStatementStatus;
  readonly actorUserId: string;
  readonly actorMembershipId: string;
  readonly recordedAt: Date;
  /** البصمة اللي المراجع شافها في العرض. */
  readonly expectedFingerprint: string;
  /** بصمة الكشف اللي المراجع شافها في العرض. */
  readonly expectedStatementFingerprint: string;
  /** بصمة المدخلات بعد إعادة الحساب تحت القفل. */
  readonly currentFingerprint: string;
  /** بصمة الصفوف بعد إعادة الحساب تحت القفل. */
  readonly currentStatementFingerprint: string;
  /** فشل التسعير: موظفة من غير خطة أو من غير مرتب. */
  readonly pricingFailures: readonly CommissionStatementBlockingIssue[];
  /** التصحيحات الموقوفة المفتوحة اللي كشفها المحتجز هو الشهر ده (FR-048). */
  readonly blockedCorrections: readonly CommissionStatementBlockingIssue[];
}

/** انتقال حالة الكشف المراجَع: REVIEWED ببصمتيه وبالمراجع وبوقته. */
export interface CommissionStatementReviewTransition {
  readonly statementId: string;
  readonly status: 'REVIEWED';
  readonly review: {
    readonly fingerprint: string;
    readonly statementFingerprint: string;
    readonly actorUserId: string;
    readonly actorMembershipId: string;
    readonly recordedAt: Date;
  };
}

/** خطة المراجعة: مراجعة مقبولة، أو رفض بثلاثة أسباب. */
export type CommissionStatementReviewPlan =
  | { readonly kind: 'REVIEWED'; readonly transition: CommissionStatementReviewTransition }
  | { readonly kind: 'NOT_DRAFT'; readonly status: CommissionStatementStatus }
  | { readonly kind: 'BLOCKED'; readonly issues: readonly CommissionStatementBlockingIssue[] }
  | {
      readonly kind: 'STALE';
      readonly changed: StatementChangeCause;
      readonly currentFingerprint: string;
      readonly currentStatementFingerprint: string;
    };

/**
 * يبني خطة مراجعة كشف شهر (FR-029).
 * الترتيب إلزامي: الكشف لازم يكون مسودة، ومفيش مشكلة بتمنع المراجعة، والبصمتان اللي اتحسبت تحت
 * القفل لازم تطابق اللي المراجع شافها؛ غير كده يُرفض قبل أي كتابة.
 * المشكلة بتمنع المراجعة بتجمع فشل التسعير (موظفة من غير خطة أو مرتب) والتصحيح الموقوف المفتوح
 * اللي كشفه المحتجز هو الشهر ده (FR-048)، والنتيجة قائمة موظفات وكود سبب التوقف.
 * البصمة المخالفة بترجع STALE مع سبب التغيّر (INPUTS أو STATEMENT)، فالشاشة تعرف تعرض الرجوع
 * للمسودة بدل إعادة محاولة هترفض بنفس الشكل.
 *
 * @param input حقائق الكشف والفاعل والبصمتان المتوقعة والمحسوبة والمشاكل
 * @returns خطة مراجعة، أو سبب رفض مكتوب
 */
export function planCommissionStatementReview(
  input: CommissionStatementReviewInput,
): CommissionStatementReviewPlan {
  if (input.status !== 'DRAFT') return { kind: 'NOT_DRAFT', status: input.status };
  const issues = [...input.pricingFailures, ...input.blockedCorrections];
  if (issues.length > 0) return { kind: 'BLOCKED', issues };
  const changed = statementChangeCause(
    { input: input.expectedFingerprint, statement: input.expectedStatementFingerprint },
    { input: input.currentFingerprint, statement: input.currentStatementFingerprint },
  );
  if (changed !== null) {
    return {
      kind: 'STALE',
      changed,
      currentFingerprint: input.currentFingerprint,
      currentStatementFingerprint: input.currentStatementFingerprint,
    };
  }
  return {
    kind: 'REVIEWED',
    transition: {
      statementId: input.statementId,
      status: 'REVIEWED',
      review: {
        fingerprint: input.currentFingerprint,
        statementFingerprint: input.currentStatementFingerprint,
        actorUserId: input.actorUserId,
        actorMembershipId: input.actorMembershipId,
        recordedAt: input.recordedAt,
      },
    },
  };
}
