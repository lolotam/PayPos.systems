'use client';

import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import type { StatementScope } from '../api/commission-statement-client';
import { isBusinessReading, type StatementReading } from '../model/statement-reading';
import { StatementPayDialog } from './statement-pay-dialog';
import { useStatementPayDialog } from './use-statement-pay-dialog';

/**
 * زر «تسجيل الدفع» (54-1) ومكان «تصدير» (56-1c): بياخدوا الشهر وحالة الكشف المعروضة من الصفحة،
 * من غير ما يغيّروا باقي أزرار الكشف. حوار الصرف بيحتفظ بالقراءة اللي المستخدم فتحه عليها.
 */
export function StatementExtraActions(props: {
  scope: StatementScope;
  period: string;
  reading: StatementReading;
  stale: boolean;
  onReload(): void;
}) {
  const { scope, period, reading, stale, onReload } = props;
  const locale = useLocale();
  const dialog = useStatementPayDialog(scope, period);
  return (
    <div className="flex flex-wrap gap-2">
      {isBusinessReading(reading) && reading.status === 'APPROVED' ? (
        <Button disabled={stale || dialog.command.isPending} onClick={() => dialog.show(reading)}>
          {t(locale, 'commissionStatementScreen.pay')}
        </Button>
      ) : null}
      {dialog.done ? <p role="status">{t(locale, 'commissionStatementScreen.donePaid')}</p> : null}
      {dialog.open === null ? null : (
        <StatementPayDialog reading={dialog.open.reading} pending={dialog.command.isPending}
          error={dialog.command.error} onConfirm={dialog.confirm} onClose={dialog.close}
          onReload={() => { dialog.close(); onReload(); }} />
      )}
    </div>
  );
}
