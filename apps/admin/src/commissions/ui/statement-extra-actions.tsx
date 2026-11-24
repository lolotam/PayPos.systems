'use client';

import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import type { ActionState } from '../model/statement-display';
import type { StatementPick } from './statement-actions';
import { StatementActionButton } from './statement-action-button';

/**
 * مكان أزرار الشرائح اللي بتتضاف على الكشف من برّه أزراره الأساسية: «تسجيل الدفع» (54-1)، و«تصدير» (56-1c)
 * بتضيف زرارها هنا بنفس الشكل من غير ما تلمس باقي الأزرار.
 */
export function StatementExtraActions({
  pay,
  onPick,
}: {
  pay: ActionState;
  onPick(pick: StatementPick): void;
}) {
  const locale = useLocale();
  return (
    <StatementActionButton
      state={pay}
      variant="primary"
      label={t(locale, 'commissionStatementScreen.pay')}
      onClick={() => onPick('pay')}
    />
  );
}
