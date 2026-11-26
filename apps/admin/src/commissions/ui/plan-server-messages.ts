import type { Locale, MessageKey } from '@pospay/i18n';
import { t } from '@pospay/i18n';
import { envelopeMessage } from '@/shared/api/api-error';

/** أكواد السيرفر اللي ليها رسالة جاهزة في كتالوج errors (مصدرها commissionPlanErrors في packages/i18n). */
const PLAN_SERVER_CODE_KEYS: Record<string, MessageKey> = {
  EMPLOYEE_NOT_FOUND: 'errors.EMPLOYEE_NOT_FOUND',
  COMMISSION_REPAIR_NOT_ALLOWED: 'errors.COMMISSION_REPAIR_NOT_ALLOWED',
  COMMISSION_PLAN_EMPLOYEE_CURSOR_UNAVAILABLE: 'errors.COMMISSION_PLAN_EMPLOYEE_CURSOR_UNAVAILABLE',
};

/** رسالة رفض السيرفر: أكواد الخطط المعروفة من كتالوج errors، وأي غلاف تاني من حقله الموثّقة. */
export function planRefusalMessage(error: unknown, locale: Locale): string {
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && Object.hasOwn(PLAN_SERVER_CODE_KEYS, code))
      return t(locale, PLAN_SERVER_CODE_KEYS[code] as MessageKey);
  }
  return envelopeMessage(error, locale);
}
