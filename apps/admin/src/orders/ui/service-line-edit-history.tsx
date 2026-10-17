'use client';
import { parseMoney } from '@pospay/domain';
import { formatInstant, formatKwd, t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useLineEditHistory } from '../api/use-line-edit-history';
import type { SessionServiceScope } from '../api/use-session-services';
import { serviceSessionAccessRevoked } from '../model/service-session-access';

const kwd = (value: string) => formatKwd(parseMoney(value));

export function ServiceLineEditHistory({ scope, sessionId, lineId, timezone }: {
  scope: SessionServiceScope; sessionId: string; lineId: string; timezone: string;
}) {
  const locale = useLocale();
  const query = useLineEditHistory(scope, sessionId, lineId, true);
  const failure = <p role="alert">{envelopeMessage(query.error, locale)} <Button type="button" variant="outline" onClick={() => { void query.refetch(); }}>{t(locale, 'serviceLineEdit.retry')}</Button></p>;
  // خطأ الصلاحية بيسيب صفحات السجل القديمة؛ الرسالة بس، من غير الأسباب ولا الأسعار المخزنة.
  if (serviceSessionAccessRevoked(query.error)) return failure;
  if (query.isPending) return <p>{t(locale, 'serviceLineEdit.loading')}</p>;
  if (query.isError) return failure;
  const items = query.data.pages.flatMap((page) => page.items);
  if (!items.length) return <p>{t(locale, 'serviceLineEdit.historyEmpty')}</p>;
  return <div className="grid gap-2 text-start">
    <ol className="grid gap-2">
      {items.map((item) => <li key={item.revision} className="grid gap-1">
        <p>{t(locale, 'serviceLineEdit.revision')} {item.revision}</p>
        <p>{t(locale, 'serviceLineEdit.was')} <bdi>{kwd(item.previous.price)}</bdi> <bdi>{kwd(item.previous.discount)}</bdi> <bdi>{kwd(item.previous.net)}</bdi></p>
        <p>{t(locale, 'serviceLineEdit.became')} <bdi>{kwd(item.new.price)}</bdi> <bdi>{kwd(item.new.discount)}</bdi> <bdi>{kwd(item.new.net)}</bdi></p>
        <p>{formatInstant(new Date(item.changed_at), locale, timezone)}</p>
        <p>{t(locale, 'serviceLineEdit.editor')} {locale === 'ar' ? item.editor_label_ar : item.editor_label_en}</p>
        <p>{item.reason}</p>
      </li>)}
    </ol>
    {query.hasNextPage ? <Button type="button" variant="outline" onClick={() => { void query.fetchNextPage(); }}>{t(locale, 'serviceLineEdit.more')}</Button> : null}
  </div>;
}
