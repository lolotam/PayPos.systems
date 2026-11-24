'use client';

import { t } from '@pospay/i18n';
import { PageHeader, PageShell } from '@pospay/ui';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { statementScope } from '../api/commission-statement-client';
import {
  isStatementDenied,
  isStatementRefused,
  useCommissionStatement,
} from '../api/use-commission-statement';
import { statusOf } from '../model/statement-display';
import { isGenerated } from '../model/statement-reading';
import { defaultStatementPeriod } from '../model/statement-period';
import { StatementDenied } from '../ui/statement-denied';
import { StatementLoadFailed } from '../ui/statement-load-failed';
import { StatementNotGenerated } from '../ui/statement-not-generated';
import { StatementPanel } from '../ui/statement-panel';
import { StatementStatusBadge } from '../ui/statement-status-badge';
import { StatementToolbar } from '../ui/statement-toolbar';

type CommissionStatementPageProps = { companyId: string; userId: string; businessId: string };

/**
 * شاشة كشف العمولة الشهري لنشاط واحد وشهر واحد: اختيار الشهر وحالة الكشف، وبعدها العرض بأزراره، أو
 * حالة التحميل أو الرفض أو الفشل. الأرقام والبصمات من السيرفر زي ما هي، والصلاحية بيفحصها السيرفر.
 */
export function CommissionStatementPage({ companyId, userId, businessId }: CommissionStatementPageProps) {
  const locale = useLocale();
  const scope = statementScope(companyId, businessId, userId);
  const [period, setPeriod] = useState(() => defaultStatementPeriod(new Date()));
  const statement = useCommissionStatement(scope, period);
  // رفض القراءة (403 أو 404) بيخفي الكشف اللي كان محمّل، مش بيسيبه على الشاشة جنب الرسالة.
  const refused = statement.isError && isStatementRefused(statement.error);
  const reading = refused ? undefined : statement.data;
  const stale = statement.isRefetchError || statement.isFetching;
  return (
    <PageShell layout="list">
      <PageHeader title={t(locale, 'commissionStatementScreen.pageTitle')} />
      <StatementToolbar
        period={period}
        onPeriod={setPeriod}
        status={reading === undefined ? null : <StatementStatusBadge status={statusOf(reading)} />}
      />
      {statement.isPending ? <p role="status">{t(locale, 'commissionStatementScreen.loading')}</p> : null}
      {statement.isError && isStatementDenied(statement.error) ? <StatementDenied /> : null}
      {statement.isRefetchError && reading !== undefined ? (
        <p role="status">{t(locale, 'commissionStatementScreen.refreshFailed')}</p>
      ) : null}
      {statement.isError && !isStatementDenied(statement.error) ? (
        <StatementLoadFailed error={statement.error} onRetry={() => void statement.refetch()} />
      ) : null}
      {reading === undefined ? null : (
        <>
          {isGenerated(reading) ? null : <StatementNotGenerated />}
          <StatementPanel
            key={period}
            scope={scope}
            period={period}
            reading={reading}
            stale={stale}
            onReload={() => void statement.refetch()}
          />
        </>
      )}
    </PageShell>
  );
}
