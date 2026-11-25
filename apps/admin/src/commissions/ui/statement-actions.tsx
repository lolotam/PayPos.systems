'use client';

import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import type { StatementActions as Actions } from '../model/statement-display';
import { StatementActionButton } from './statement-action-button';
import { StatementExtraActions } from './statement-extra-actions';

/** أمر الزرار اللي المستخدم ضغطه، عشان الصفحة تفتح حوار التأكيد بتاعه. */
export type StatementPick = 'generate' | 'review' | 'return' | 'approve' | 'pay';

/** أزرار الكشف اللي الحالة بتسمح بيها، وبعدها مكان أزرار الشرائح الجاية. */
export function StatementActions({
  actions,
  generated,
  onPick,
  onExport,
}: {
  actions: Actions;
  generated: boolean;
  onPick(pick: StatementPick): void;
  onExport(): void;
}) {
  const locale = useLocale();
  const generateLabel = generated
    ? 'commissionStatementScreen.refresh'
    : 'commissionStatementScreen.generate';
  return (
    <div className="flex flex-wrap gap-2">
      <StatementActionButton
        state={actions.generate}
        variant={generated ? 'outline' : 'primary'}
        label={t(locale, generateLabel)}
        onClick={() => onPick('generate')}
      />
      <StatementActionButton
        state={actions.review}
        variant="primary"
        label={t(locale, 'commissionStatementScreen.review')}
        onClick={() => onPick('review')}
      />
      <StatementActionButton
        state={actions.returnToDraft}
        variant="outline"
        label={t(locale, 'commissionStatementScreen.returnToDraft')}
        onClick={() => onPick('return')}
      />
      <StatementActionButton
        state={actions.approve}
        variant="primary"
        label={t(locale, 'commissionStatementScreen.approve')}
        onClick={() => onPick('approve')}
      />
      <StatementExtraActions
        pay={actions.pay}
        exportState={actions.export}
        onPick={onPick}
        onExport={onExport}
      />
    </div>
  );
}
