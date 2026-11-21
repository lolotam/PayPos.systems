import type { CreateCommissionServiceOverrideInput } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import type { FieldErrors, Resolver } from 'react-hook-form';
import { toOverrideBody, type OverrideDraft } from './override-draft';
import { OVERRIDE_FIELD_ERROR_KEYS } from './override-messages';

const fieldError = (message: string) => ({ type: 'validation' as const, message });

/**
 * بيحوّل نتيجة قراءة المسودة لأخطاء الفورم: كل خطأ بيرجع للحقل اللي سببته، ورفض العقد اللي
 * ملوش حقل بيبقى على نوع القاعدة عشان الحفظ يقفل بدل ما يطلع الفورم صالح.
 */
export function createOverrideResolver(
  serviceId: string,
  locale: Locale,
): Resolver<OverrideDraft, unknown, CreateCommissionServiceOverrideInput> {
  return (values) => {
    const { parsed, errors: fieldErrors } = toOverrideBody(values, serviceId);
    const errors: FieldErrors<OverrideDraft> = {};
    for (const error of fieldErrors)
      Object.assign(errors, {
        [error.field]: fieldError(t(locale, OVERRIDE_FIELD_ERROR_KEYS[error.code])),
      });
    if (!parsed.success && Object.keys(errors).length === 0)
      Object.assign(errors, { kind: fieldError(t(locale, 'admin.unexpected')) });
    if (!parsed.success || Object.keys(errors).length > 0) return { values: {}, errors };
    return { values: parsed.data, errors: {} };
  };
}
