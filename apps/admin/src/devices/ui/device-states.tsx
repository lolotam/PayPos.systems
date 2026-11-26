'use client';

import { t } from '@pospay/i18n';

import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';

// حالات القراءة والقرار في قوائم الأجهزة: التحميل، ورفض السيرفر، والرسالة الفاضية، ورفض الإجراء.
export function DeviceStates({
  loading,
  error,
  actionError,
  empty,
  emptyText,
}: {
  loading: boolean;
  error: unknown;
  actionError: unknown;
  empty: boolean;
  emptyText: string;
}) {
  const locale = useLocale();
  return (
    <>
      {loading ? <p role="status">{t(locale, 'devices.loading')}</p> : null}
      {error === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {envelopeMessage(error, locale)}
        </p>
      )}
      {!loading && error === null && empty ? <p>{emptyText}</p> : null}
      {actionError === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {envelopeMessage(actionError, locale)}
        </p>
      )}
    </>
  );
}
