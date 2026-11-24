'use client';

import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import type { StatementActions as Actions, ActionState } from '../model/statement-display';
import { StatementExtraActions } from './statement-extra-actions';

/** أمر الزرار اللي المستخدم ضغطه، عشان الصفحة تفتح حوار التأكيد بتاعه. */
export type StatementPick = 'generate' | 'review' | 'return';

function Action({
  state,
  variant,
  label,
  onClick,
}: {
  state: ActionState;
  variant: 'primary' | 'outline';
  label: string;
  onClick(): void;
}) {
  if (state === 'hidden') return null;
  return (
    <Button variant={variant} disabled={state === 'disabled'} onClick={onClick}>
      {label}
    </Button>
  );
}

/** أزرار الكشف اللي الحالة بتسمح بيها، وبعدها مكان أزرار الشرائح الجاية. */
export function StatementActions({
  actions,
  generated,
  onPick,
}: {
  actions: Actions;
  generated: boolean;
  onPick(pick: StatementPick): void;
}) {
  const locale = useLocale();
  const generateLabel = generated ? 'commissionStatementScreen.refresh' : 'commissionStatementScreen.generate';
  return (
    <div className="flex flex-wrap gap-2">
      <Action state={actions.generate} variant={generated ? 'outline' : 'primary'} label={t(locale, generateLabel)} onClick={() => onPick('generate')} />
      <Action state={actions.review} variant="primary" label={t(locale, 'commissionStatementScreen.review')} onClick={() => onPick('review')} />
      <Action state={actions.returnToDraft} variant="outline" label={t(locale, 'commissionStatementScreen.returnToDraft')} onClick={() => onPick('return')} />
      <StatementExtraActions />
    </div>
  );
}
