'use client';
import { parseMoney } from '@pospay/domain';
import { formatInstant, formatKwd, t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useEffect } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useServiceLineCancellation } from '../api/use-service-line-cancellation';
import type { SessionServiceScope } from '../api/use-session-services';
import { serviceSessionAccessRevoked } from '../model/service-session-access';

const kwd = (value: string) => formatKwd(parseMoney(value));

export function ServiceLineCancellationDetails({
  scope,
  sessionId,
  lineId,
  timezone,
  onAccessDenied,
}: {
  scope: SessionServiceScope;
  sessionId: string;
  lineId: string;
  timezone: string;
  onAccessDenied: (message: string) => void;
}) {
  const locale = useLocale();
  const query = useServiceLineCancellation(scope, sessionId, lineId, true);
  const revoked = serviceSessionAccessRevoked(query.error);
  // خطأ الصلاحية بيقفل الصفحة كلها؛ لو اللوحة بس اختفت الأسعار والاسم يفضلوا ظاهرين في الكاش جنب الزيارات.
  useEffect(() => {
    if (revoked) onAccessDenied(envelopeMessage(query.error, locale));
  }, [revoked, query.error, locale, onAccessDenied]);
  if (revoked) return <p role="alert">{envelopeMessage(query.error, locale)}</p>;
  if (query.isPending) return <p>{t(locale, 'serviceLineEdit.loading')}</p>;
  if (query.isError) {
    return (
      <p role="alert">
        {envelopeMessage(query.error, locale)}{' '}
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void query.refetch();
          }}
        >
          {t(locale, 'serviceLineEdit.retry')}
        </Button>
      </p>
    );
  }
  const row = query.data;
  const label = locale === 'ar' ? row.canceller_label_ar : row.canceller_label_en;
  return (
    <div className="grid gap-1 text-start">
      <p>{formatInstant(new Date(row.cancelled_at), locale, timezone)}</p>
      <p>
        {t(locale, 'serviceLineCancel.canceller')} {label}
      </p>
      <p>
        {t(locale, 'serviceLineCancel.reason')} {row.reason}
      </p>
      <p>
        {t(locale, 'serviceLineEdit.was')} {t(locale, 'serviceSessions.price')}{' '}
        <bdi>{kwd(row.previous.price)}</bdi> {t(locale, 'serviceLineEdit.discount')}{' '}
        <bdi>{kwd(row.previous.discount)}</bdi> {t(locale, 'serviceLineEdit.net')}{' '}
        <bdi>{kwd(row.previous.net)}</bdi>
      </p>
    </div>
  );
}
