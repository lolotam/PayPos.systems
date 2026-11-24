'use client';

import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import type { StatementScope } from '../api/commission-statement-client';
import type { StatementAttemptMemory } from '../api/use-statement-command';
import { statementActions } from '../model/statement-display';
import { isBusinessReading, type StatementReading } from '../model/statement-reading';
import { StatementActions } from './statement-actions';
import { StatementChangedNotice } from './statement-changed-notice';
import { StatementCommandDialog } from './statement-command-dialog';
import { StatementEmployeeCard } from './statement-employee-card';
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
  memory: StatementAttemptMemory;
  onReload(): void;
}) {
  const { scope, period, reading, memory, onReload } = props;
  const locale = useLocale();
  const dialog = useStatementDialog(scope, period, memory, onReload);
  return (
    <div className="flex flex-col gap-4">
      {isBusinessReading(reading) ? (
        <StatementChangedNotice reading={reading} />
      ) : (
        <p>{t(locale, `${NS}.branchReaderNote`)}</p>
      )}
      <StatementActions
        actions={statementActions(reading)}
        generated={reading.generated}
        onPick={(pick) => dialog.show(pick, reading)}
      />
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
