'use client';

import { t } from '@pospay/i18n';

import { useLocale } from '@/shared/locale/locale-context';

/**
 * تنبيه واحد ثابت يبقى في مجال الرؤية مهما طال الإطار: في أعلى ترتيب z، وخصائص منطقية تصلح للاتجاهين.
 */
export function NavStyleSaveAlert() {
  const locale = useLocale();
  return (
    <p
      role="alert"
      className="fixed bottom-4 end-4 z-50 max-w-96 rounded-card border border-destructive bg-card px-4 py-3 text-sm text-destructive shadow-lg"
    >
      {t(locale, 'adminNav.saveFailed')}
    </p>
  );
}
