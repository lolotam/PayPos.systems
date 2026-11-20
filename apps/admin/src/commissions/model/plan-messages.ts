import type {
  CommissionPlanWire,
  CommissionValidationError,
} from '@pospay/commissions-engine/validation';
import { t, type Locale, type MessageKey } from '@pospay/i18n';
import { checkPlanBlocks } from './plan-check';
import type { DraftErrorCode } from './plan-draft';

/** أكواد المحرك السبعة بمفاتيح الرسائل في كتالوج منشئ الخطة. */
export const PLAN_ERROR_KEYS: Record<CommissionValidationError, MessageKey> = {
  INVALID_COMBINATION: 'commissionPlanBuilder.errorInvalidCombination',
  MIXED_THRESHOLDS: 'commissionPlanBuilder.errorMixedThresholds',
  STEPS_NOT_ASCENDING: 'commissionPlanBuilder.errorStepsNotAscending',
  NO_STEPS: 'commissionPlanBuilder.errorNoSteps',
  INVALID_CALC: 'commissionPlanBuilder.errorInvalidCalc',
  INVALID_THRESHOLD: 'commissionPlanBuilder.errorInvalidThreshold',
  INVALID_PLAN: 'commissionPlanBuilder.errorInvalidPlan',
};

/** أكواد قراءة الحقول بمفاتيح الرسائل. */
export const DRAFT_ERROR_KEYS: Record<DraftErrorCode, MessageKey> = {
  INVALID_DATE: 'commissionPlanBuilder.errorInvalidDate',
  INVALID_BPS: 'commissionPlanBuilder.errorInvalidBps',
  INVALID_MONEY: 'commissionPlanBuilder.errorInvalidMoney',
  INVALID_SESSIONS: 'commissionPlanBuilder.errorInvalidSessions',
  INVALID_MULTIPLE: 'commissionPlanBuilder.errorInvalidMultiple',
};

/**
 * يقرأ كود الخطة من details في غلاف رفض 422 COMMISSION_PLAN_INVALID، أو null لغيره
 * عشان يعرض برسالته الخاصة بدل رسالة أكواد المحرك.
 *
 * @param error الخطأ القادم من طبقة الطلب
 * @returns كود المحرك أو null
 */
function planErrorCode(error: unknown): CommissionValidationError | null {
  if (typeof error !== 'object' || error === null) return null;
  const envelope = error as { code?: unknown; details?: unknown };
  if (envelope.code !== 'COMMISSION_PLAN_INVALID') return null;
  if (typeof envelope.details !== 'object' || envelope.details === null) return null;
  const code = (envelope.details as { code?: unknown }).code;
  // hasOwn مش in عشان أسماء موروثة زي constructor ما تتعملش أكواد محرك.
  return typeof code === 'string' && Object.hasOwn(PLAN_ERROR_KEYS, code)
    ? (code as CommissionValidationError)
    : null;
}

/** رسالة السيرفر بلغة الواجهة من غلاف الخطأ، أو null لو مالوش رسالة صالحة فيستعمل errorSaveFailed. */
function serverMessage(error: unknown, locale: Locale): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const key = locale === 'ar' ? 'message_ar' : 'message_en';
  const message = (error as Record<string, unknown>)[key];
  return typeof message === 'string' && message !== '' ? message : null;
}

export interface PlanServerAlerts {
  base: string | null;
  tiers: string | null;
  packageSale: string | null;
  form: string | null;
}

const BLOCK_NAMES = ['base', 'tiers', 'packageSale'] as const;

function noAlerts(): PlanServerAlerts {
  return { base: null, tiers: null, packageSale: null, form: null };
}

/**
 * كود COMMISSION_PLAN_INVALID بيظهر في البلوك الوحيد اللي بيطابقه فحص الجسم، والملتبس أو
 * غير المطابق بيظهر مرة واحدة على الفورم؛ أي غلاف تاني بيعرض رسالته أو الرسالة العامة.
 */
export function planServerAlerts(
  serverError: unknown,
  body: CommissionPlanWire | null,
  locale: Locale,
): PlanServerAlerts {
  if (serverError == null) return noAlerts();
  const code = planErrorCode(serverError);
  if (code === null) {
    return {
      ...noAlerts(),
      form: serverMessage(serverError, locale) ?? t(locale, 'commissionPlanBuilder.errorSaveFailed'),
    };
  }
  const alerts = noAlerts();
  if (body !== null) {
    const blocks = checkPlanBlocks(body);
    const placed = BLOCK_NAMES.filter((block) => blocks[block] === code);
    const target = placed.length === 1 ? placed[0] : undefined;
    if (target !== undefined) {
      alerts[target] = t(locale, PLAN_ERROR_KEYS[code]);
      return alerts;
    }
  }
  alerts.form = t(locale, PLAN_ERROR_KEYS[code]);
  return alerts;
}
