import { t, type Locale, type MessageKey } from '@pospay/i18n';
import { envelopeMessage } from '@/shared/api/api-error';
import type { OverrideFieldErrorCode } from './override-draft';

/** أكواد أخطاء قراءة الحقول بمفاتيح شاشة العمولة الخاصة. */
export const OVERRIDE_FIELD_ERROR_KEYS: Record<OverrideFieldErrorCode, MessageKey> = {
  INVALID_DATE: 'commissionOverrides.errorInvalidDate',
  INVALID_BPS: 'commissionOverrides.errorInvalidBps',
  INVALID_MONEY: 'commissionOverrides.errorInvalidMoney',
};

/** مكان الرسالة في الشاشة: تحت خانة التاريخ أو على الفورم كله. */
export type OverrideServerAlerts = { effectiveFrom: string | null; form: string | null };

/**
 * يحوّل رفض السيرفر لرسالة في مكانها: تاريخ في الماضي تحت خانة التاريخ، وباقي الأكواد
 * المعروفة على الفورم، وأي كود تاني بياخد رسالة الغلاف نفسها.
 */
export function overrideServerAlerts(serverError: unknown, locale: Locale): OverrideServerAlerts {
  if (serverError === null || serverError === undefined) return { effectiveFrom: null, form: null };
  const code = (serverError as { code?: unknown }).code;
  if (code === 'COMMISSION_EFFECTIVE_FROM_PAST')
    return { effectiveFrom: t(locale, 'errors.COMMISSION_EFFECTIVE_FROM_PAST'), form: null };
  if (code === 'EMPLOYEE_NOT_FOUND')
    return { effectiveFrom: null, form: t(locale, 'errors.EMPLOYEE_NOT_FOUND') };
  if (code === 'SERVICE_NOT_FOUND')
    return { effectiveFrom: null, form: t(locale, 'errors.SERVICE_NOT_FOUND') };
  if (code === 'COMMISSION_PERIOD_CLOSED')
    return { effectiveFrom: null, form: t(locale, 'errors.COMMISSION_PERIOD_CLOSED') };
  if (code === 'FEATURE_DISABLED')
    return { effectiveFrom: null, form: t(locale, 'errors.FEATURE_DISABLED') };
  return { effectiveFrom: null, form: envelopeMessage(serverError, locale) };
}
