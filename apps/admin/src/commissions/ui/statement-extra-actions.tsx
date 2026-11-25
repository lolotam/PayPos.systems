'use client';

import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import type { ActionState } from '../model/statement-display';
import type { StatementPick } from './statement-actions';
import { StatementActionButton } from './statement-action-button';

/**
 * مكان أزرار الشرائح اللي بتتضاف على الكشف من برّه أزراره الأساسية: «تسجيل الدفع» (54-1)، و«تصدير إكسل» (56)
 * اللي بيفتح حوار التصدير من غير ما يمر على حوار تأكيد الأوامر.
 */
export function StatementExtraActions({
  pay,
  exportState,
  onPick,
  onExport,
}: {
  pay: ActionState;
  exportState: ActionState;
  onPick(pick: StatementPick): void;
  onExport(): void;
}) {
  const locale = useLocale();
  return (
    <>
      <StatementActionButton
        state={pay}
        variant="primary"
        label={t(locale, 'commissionStatementScreen.pay')}
        onClick={() => onPick('pay')}
      />
      <StatementActionButton
        state={exportState}
        variant="outline"
        label={t(locale, 'commissionStatementScreen.exportExcel')}
        onClick={onExport}
      />
    </>
  );
}
