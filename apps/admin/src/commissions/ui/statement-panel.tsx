'use client';

import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import type { StatementScope } from '../api/commission-statement-client';
import { statementActions, switchedOff } from '../model/statement-display';
import { isGenerated, isOpenBusinessReading, type StatementReading } from '../model/statement-reading';
import { StatementActions } from './statement-actions';
import { StatementChangedNotice } from './statement-changed-notice';
import { StatementCommandDialog } from './statement-command-dialog';
import { StatementEmployeeCard } from './statement-employee-card';
import { StatementExtraActions } from './statement-extra-actions';
import { StatementPaymentBlock } from './statement-payment-block';
import { useStatementDialog } from './use-statement-dialog';

const NS = 'commissionStatementScreen';

/**
 * كشف الشهر المعروض: تنبيهاته وأزراره وموظفاته، وحوار تأكيد الأمر. كل أمر بيتأكد في حوار، وبيتبعت ببصمتي
 * العرض اللي كان قدام المستخدم لحظة الفتح، وبيقفل الحوار بس لما السيرفر يقبله.
 */
export function StatementPanel(props: {
  scope: StatementScope;
  period: string;
  reading: StatementReading;
  stale: boolean;
  onReload(): void;
}) {
  const { scope, period, reading, stale, onReload } = props;
  const locale = useLocale();
  const dialog = useStatementDialog(scope, period, onReload);
  return (
    <div className="flex flex-col gap-4">
      {isOpenBusinessReading(reading) ? <StatementChangedNotice reading={reading} /> : null}
      {reading.reader_scope === 'BRANCHES' ? <p>{t(locale, `${NS}.branchReaderNote`)}</p> : null}
      <StatementActions
        actions={stale ? switchedOff(statementActions(reading)) : statementActions(reading)}
        generated={isGenerated(reading)}
        onPick={(pick) => dialog.show(pick, reading)}
      />
      <StatementExtraActions scope={scope} period={period} reading={reading} stale={stale} onReload={onReload} />
      <StatementPaymentBlock reading={reading} />
      {dialog.done === null ? null : <p role="status">{t(locale, dialog.done)}</p>}
      {reading.employees.length === 0 ? <p>{t(locale, `${NS}.noEmployees`)}</p> : null}
      {reading.employees.map((employee) => (
        <StatementEmployeeCard key={employee.employee_id} employee={employee} />
      ))}
      {dialog.open === null ? null : (
        <StatementCommandDialog
          pick={dialog.open.pick}
          pending={dialog.command.isPending}
          error={dialog.command.error}
          employees={reading.employees}
          onConfirm={(body) => dialog.confirm(body?.reason)}
          onClose={dialog.close}
          onReload={dialog.reload}
        />
      )}
    </div>
  );
}
