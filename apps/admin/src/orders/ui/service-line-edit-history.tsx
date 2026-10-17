'use client';
import { parseMoney } from '@pospay/domain';
import { formatInstant, formatKwd, t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useState } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useLineEditHistory } from '../api/use-line-edit-history';
import type { SessionServiceScope } from '../api/use-session-services';
import { serviceSessionAccessRevoked, serviceSessionDenial } from '../model/service-session-access';

const kwd = (value: string) => formatKwd(parseMoney(value));

function historyAccessKey(scope: SessionServiceScope, sessionId: string, lineId: string) {
  return [scope.companyId, scope.businessId, scope.branchId, scope.userId, sessionId, lineId].join(':');
}

export function ServiceLineEditHistory({ scope, sessionId, lineId, timezone }: {
  scope: SessionServiceScope; sessionId: string; lineId: string; timezone: string;
}) {
  const locale = useLocale();
  const [deniedFor, setDeniedFor] = useState<string | null>(null);
  const query = useLineEditHistory(scope, sessionId, lineId, true);
  const access = serviceSessionDenial(deniedFor, historyAccessKey(scope, sessionId, lineId), serviceSessionAccessRevoked(query.error), query.isSuccess && !query.isError);
  if (access.nextKey !== deniedFor) setDeniedFor(access.nextKey);
  const failure = <p role="alert">{envelopeMessage(query.error, locale)} <Button type="button" variant="outline" onClick={() => { void query.refetch(); }}>{t(locale, 'serviceLineEdit.retry')}</Button></p>;
  if (access.denied) return failure;
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
