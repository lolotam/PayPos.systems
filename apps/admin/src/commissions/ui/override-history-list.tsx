'use client';

import { t } from '@pospay/i18n';
import { Badge, Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { useCommissionOverrideHistory } from '../api/use-commission-override-history';
import type { PlanScope } from '../api/plan-access';
import { overrideRuleText } from '../model/override-rule-text';
import { planRefusalMessage } from './plan-server-messages';
import { civilDate, stampDate } from './plan-history-columns';

interface OverrideHistoryListProps {
  scope: PlanScope;
  employeeId: string;
  serviceId: string;
  timeZone: string;
}

/**
 * تاريخ تجاوزات خدمة واحدة: الأحدث فوق زي ما السيرفر رجّعه، وعلامة «سارية» من السيرفر نفسه
 * مش محسوبة من تاريخ ولا من ترتيب السطر.
 */
export function OverrideHistoryList({ scope, employeeId, serviceId, timeZone }: OverrideHistoryListProps) {
  const locale = useLocale();
  const history = useCommissionOverrideHistory(scope, employeeId, serviceId);
  const items = history.data?.pages.flatMap((page) => page.items) ?? [];
  const loadMore = () => history.fetchNextPage().catch(() => undefined);
  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-bold">{t(locale, 'commissionOverrides.historyTitle')}</h3>
      {history.isError ? <p role="alert">{planRefusalMessage(history.error, locale)}</p> : null}
      {history.isSuccess && items.length === 0 ? <p>{t(locale, 'commissionOverrides.historyEmpty')}</p> : null}
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center gap-2">
            <span>{overrideRuleText(item.rule, locale)}</span>
            <span>{civilDate(item.effective_from, locale)}</span>
            <span>{stampDate(item.created_at, locale, timeZone)}</span>
            {item.is_current ? (
              <Badge variant="success">{t(locale, 'commissionOverrides.currentBadge')}</Badge>
            ) : null}
          </li>
        ))}
      </ul>
      {history.hasNextPage ? (
        <Button type="button" variant="outline" size="sm" disabled={history.isFetchingNextPage} onClick={loadMore}>
          {t(locale, 'commissionOverrides.loadMore')}
        </Button>
      ) : null}
      {history.isFetchNextPageError ? (
        <p role="alert">{t(locale, 'commissionOverrides.couldNotLoadMore')}</p>
      ) : null}
    </div>
  );
}
