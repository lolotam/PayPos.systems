'use client';
import type { ServiceLinePerformerChangesPage } from '@pospay/contracts';
import { formatInstant, t, type Locale } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useEffect } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useLinePerformerChanges } from '../api/use-line-performer-changes';
import type { SessionServiceScope } from '../api/use-session-services';
import { serviceSessionAccessRevoked } from '../model/service-session-access';
import { sessionBpsText } from '../model/session-recording-result';

type Item = ServiceLinePerformerChangesPage['items'][number];
type Side = Item['before'];

function SideText({ label, side, locale }: { label: string; side: Side; locale: Locale }) {
  const percent = (bps: number) =>
    t(locale, 'serviceSessions.percentValue').replace('{value}', sessionBpsText(bps));
  return (
    <p>
      {label}{' '}
      {side.map((row, index) => (
        <span key={index}>
          {index > 0 ? ', ' : null}
          {locale === 'ar' ? (row.name_ar ?? row.name_en) : row.name_en}{' '}
          <bdi>{percent(row.share_bps)}</bdi>
        </span>
      ))}
    </p>
  );
}

function ChangeItem({ item, locale, timezone }: { item: Item; locale: Locale; timezone: string }) {
  return (
    <li className="grid gap-1">
      <p>{formatInstant(new Date(item.changed_at), locale, timezone)}</p>
      <p>
        {t(locale, 'serviceLinePerformers.changer')}{' '}
        {locale === 'ar' ? item.changer_label_ar : item.changer_label_en}
      </p>
      <p>
        {t(locale, 'serviceLinePerformers.reason')} {item.reason}
      </p>
      <SideText
        label={t(locale, 'serviceLinePerformers.before')}
        side={item.before}
        locale={locale}
      />
      <SideText
        label={t(locale, 'serviceLinePerformers.after')}
        side={item.after}
        locale={locale}
      />
    </li>
  );
}

export function ServiceLinePerformerHistory({
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
  const query = useLinePerformerChanges(scope, sessionId, lineId, true);
  const revoked = serviceSessionAccessRevoked(query.error);
  // خطأ الصلاحية بيقفل الصفحة كلها؛ لو اللوحة بس اختفت أسماء المنفّذين تفضل ظاهرة في الكاش جنب الزيارات.
  useEffect(() => {
    if (revoked) onAccessDenied(envelopeMessage(query.error, locale));
  }, [revoked, query.error, locale, onAccessDenied]);
  if (revoked) return <p role="alert">{envelopeMessage(query.error, locale)}</p>;
  if (query.isPending) return <p>{t(locale, 'serviceLineEdit.loading')}</p>;
  if (query.isError) {
    return (
      <p role="alert">
        {envelopeMessage(query.error, locale)}{' '}
        <Button type="button" variant="outline" onClick={() => void query.refetch()}>
          {t(locale, 'serviceLineEdit.retry')}
        </Button>
      </p>
    );
  }
  const items = query.data.pages.flatMap((page) => page.items);
  if (!items.length) return <p>{t(locale, 'serviceLinePerformers.historyEmpty')}</p>;
  return (
    <div className="grid gap-2 text-start">
      <ol className="grid gap-2">
        {items.map((item) => (
          <ChangeItem key={item.revision} item={item} locale={locale} timezone={timezone} />
        ))}
      </ol>
      {query.hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {t(locale, 'serviceLinePerformers.more')}
        </Button>
      ) : null}
    </div>
  );
}
