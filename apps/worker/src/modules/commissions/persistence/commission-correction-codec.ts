import {
  commissionOverrideOf as engineOverrideOf,
  commissionPlanVersionOf as enginePlanVersionOf,
  commissionRuleOf as engineRuleOf,
  CommissionPlanDecodeError as EnginePlanDecodeError,
} from '@pospay/commissions-engine';

import { CommissionPlanDecodeError } from '../domain/errors.ts';

export type PlanVersionRow = {
  employeeId: string;
  version: number;
  effectiveFrom: string;
  wholePeriod: boolean;
  repairPeriod: string | null;
  plan: unknown;
  createdAt: string;
};

export type OverrideRow = {
  id: string;
  employeeId: string;
  serviceId: string;
  effectiveFrom: string;
  ruleKind: string;
  rulePctBps: number | null;
  ruleFixedAmount: string | null;
  createdAt: string;
};

/** يحوّل قاعدة الخدمة المخزّنة في أعمدةها إلى الشكل اللي بيفهمه محرك العمولة. */
export function commissionRuleOf(
  kind: string,
  pctBps: number | null,
  fixedAmount: string | null,
) {
  return engineRuleOf(kind, pctBps, fixedAmount);
}

/**
 * الخطة المحفوظة jsonb بصيغة العقد (نِسَب بأرقام ومبالغ بنصوص)، والمحرك بيشتغل
 * بمبالغ bigint، فالترجمة بتعمل في المحرك نفسه عشان الـ worker والـ API يقرؤوا
 * الخطة بنفس الترميز. أي حقل ناقص أو نوع مجهول يوقف القراءة بدل اختراع خطة صفرية.
 */
export function commissionPlanVersionOf(row: PlanVersionRow) {
  try {
    return enginePlanVersionOf(row);
  } catch (error) {
    if (error instanceof EnginePlanDecodeError) {
      throw new CommissionPlanDecodeError(error.fieldPath);
    }
    throw error;
  }
}

export function commissionOverrideOf(row: OverrideRow) {
  return engineOverrideOf(row);
}
