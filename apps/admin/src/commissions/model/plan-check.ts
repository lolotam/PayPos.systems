import type {
  CommissionPlanWire,
  CommissionValidationError,
  CommissionValidationResult,
} from '@pospay/commissions-engine/validation';
import { validateWireCommissionPlan } from '@pospay/commissions-engine/validation';

export interface PlanBlockErrors {
  base: CommissionValidationError | null;
  tiers: CommissionValidationError | null;
  packageSale: CommissionValidationError | null;
}

function codeOf(result: CommissionValidationResult): CommissionValidationError | null {
  return result.ok ? null : result.code;
}

/**
 * بيتحقق من كل بلوك لوحده بقواعد المحرك نفسها عشان الخطأ يظهر في مكانه؛ البلوكين التانيين
 * بيتبدلوا بالحرفي { enabled: false } مش بقلب المفتاح، لأن المحرك بيفحص إعدادات البلوك
 * المعطّل المحفوظة كمان فقلب المفتاح كان هيخبي أخطاء حقيقية. الملف ده مالوش قاعدة من عنده.
 *
 * @param plan جسم الخطة بصيغة العقد
 * @returns كود خطأ لكل بلوك، أو null للبلوك السليم
 */
export function checkPlanBlocks(plan: CommissionPlanWire): PlanBlockErrors {
  const off = { enabled: false } as const;
  return {
    base: codeOf(validateWireCommissionPlan({ base: plan.base, tiers: off, package_sale: off })),
    tiers: codeOf(validateWireCommissionPlan({ base: off, tiers: plan.tiers, package_sale: off })),
    packageSale: codeOf(
      validateWireCommissionPlan({ base: off, tiers: off, package_sale: plan.package_sale }),
    ),
  };
}
