import type {
  CommissionCorrectionAttribution,
  CommissionCorrectionStepInput,
  CommissionFrozenSource,
  CommissionPostedCorrection,
  CommissionRecomputedSource,
} from '../commission-correction-step.ts';

export const EMPLOYEE = '01990000-0000-7000-8000-0000000000c1';
export const TARGET_STATEMENT = '01990000-0000-7000-8000-0000000000d1';
export const EVENT = '01990000-0000-7000-8000-0000000000e1';
export const BRANCH = '01990000-0000-7000-8000-0000000000b1';

export const ATTRIBUTION: CommissionCorrectionAttribution = {
  sourceBranchId: BRANCH,
  sourceBusinessDate: '2026-10-05',
  attachedBranchIds: [BRANCH],
};

export const RESOLVED: CommissionCorrectionAttribution = {
  sourceBranchId: '01990000-0000-7000-8000-0000000000b2',
  sourceBusinessDate: '2026-10-20',
  attachedBranchIds: ['01990000-0000-7000-8000-0000000000b2'],
};

/** يجهّز مدخلات ثابتة لخطوة التصحيح مع السماح بتغيير الحقول محل الاختبار. */
export const input = (
  overrides: Partial<CommissionCorrectionStepInput> = {},
): CommissionCorrectionStepInput => ({
  sourcePeriod: '2026-10',
  employeeId: EMPLOYEE,
  generation: 1,
  targetPeriod: '2026-11',
  targetStatementId: TARGET_STATEMENT,
  eventId: EVENT,
  frozen: [],
  posted: [],
  recomputed: [],
  ...overrides,
});

/** يجهّز مصدرًا مجمّدًا بمرجع وقيمة ونسبة معروفة لمقارنة إعادة الحساب. */
export const frozen = (
  sourceRef: string,
  amount: bigint,
  attribution: CommissionCorrectionAttribution = ATTRIBUTION,
): CommissionFrozenSource => ({ sourceRef, kind: 'COMMISSION', amount, attribution });

/** يجهّز تصحيحًا منشورًا بقيمة معروفة لاختبار صافي الأجيال السابقة. */
export const posted = (sourceRef: string, amount: bigint): CommissionPostedCorrection => ({
  sourceRef,
  kind: 'COMMISSION',
  amount,
});

/** يجهّز نتيجة إعادة الحساب مع اختيارية النسبة لاختبار المصادر الجديدة والقديمة. */
export const recomputed = (
  sourceRef: string,
  amount: bigint,
  attribution?: CommissionCorrectionAttribution,
): CommissionRecomputedSource => ({
  sourceRef,
  kind: 'COMMISSION',
  amount,
  ...(attribution === undefined ? {} : { attribution }),
});
