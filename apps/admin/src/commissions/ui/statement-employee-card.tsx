'use client';

import type { CommissionStatementEmployee } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Badge, Card } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { employeeName, formatAmount, groupRows } from '../model/statement-display';
import { StatementCorrectionsSection } from './statement-corrections-section';
import { StatementIssues } from './statement-issues';
import { StatementRowsTable } from './statement-rows-table';

const NS = 'commissionStatementScreen';

/** موظفة واحدة في الكشف: اسمها ومجاميعها كما رجعت من السيرفر، ثم أقسام بنودها. */
export function StatementEmployeeCard({ employee }: { employee: CommissionStatementEmployee }) {
  const locale = useLocale();
  const groups = groupRows(employee.rows);
  return (
    <Card className="flex flex-col gap-3 p-4" aria-label={employeeName(employee, locale)}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold">{employeeName(employee, locale)}</h2>
        <span className="text-sm text-muted-foreground">
          {t(locale, `${NS}.employeeNumber`)} <bdi>{employee.employee_number}</bdi>
        </span>
        {employee.partial ? <Badge variant="warning">{t(locale, `${NS}.partialBadge`)}</Badge> : null}
      </div>
      {employee.partial ? <p className="text-sm text-muted-foreground">{t(locale, `${NS}.partialNote`)}</p> : null}
      <dl className="grid grid-cols-3 gap-3">
        <div>
          <dt className="text-sm text-muted-foreground">{t(locale, `${NS}.commissionSubtotal`)}</dt>
          <dd dir="ltr" className="text-start font-semibold">{formatAmount(employee.commission_subtotal)}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">{t(locale, `${NS}.tipSide`)}</dt>
          <dd dir="ltr" className="text-start font-semibold">{formatAmount(employee.tip_side)}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">{t(locale, `${NS}.payable`)}</dt>
          <dd dir="ltr" className="text-start font-semibold">{formatAmount(employee.payable)}</dd>
        </div>
      </dl>
      <StatementIssues issues={employee.issues} />
      {employee.rows.length === 0 ? <p>{t(locale, `${NS}.noRows`)}</p> : null}
      {groups.work.length > 0 ? <StatementRowsTable title={t(locale, `${NS}.sectionWork`)} rows={groups.work} /> : null}
      {groups.tips.length > 0 ? <StatementRowsTable title={t(locale, `${NS}.tipSide`)} rows={groups.tips} /> : null}
      {groups.corrections.length > 0 ? <StatementCorrectionsSection rows={groups.corrections} /> : null}
      {groups.carries.length > 0 ? (
        <StatementRowsTable title={t(locale, `${NS}.sectionCarries`)} rows={groups.carries} />
      ) : null}
    </Card>
  );
}
