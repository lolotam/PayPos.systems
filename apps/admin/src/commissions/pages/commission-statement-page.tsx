'use client';

import { t } from '@pospay/i18n';
import { PageHeader, PageShell } from '@pospay/ui';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { statementScope } from '../api/commission-statement-client';
import { isStatementDenied, useCommissionStatement } from '../api/use-commission-statement';
import { useStatementAttemptMemory } from '../api/use-statement-command';
import { statusOf } from '../model/statement-display';
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
  const memory = useStatementAttemptMemory();
  const statement = useCommissionStatement(scope, period);
  const reading = statement.data;
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
      {statement.isError && !isStatementDenied(statement.error) ? (
        <StatementLoadFailed error={statement.error} onRetry={() => void statement.refetch()} />
      ) : null}
      {reading === undefined ? null : (
        <>
          {reading.generated ? null : <StatementNotGenerated />}
          <StatementPanel
            key={period}
            scope={scope}
            period={period}
            reading={reading}
            memory={memory}
            onReload={() => void statement.refetch()}
          />
        </>
      )}
    </PageShell>
  );
}
