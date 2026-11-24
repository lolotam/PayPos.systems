'use client';

import { Button } from '@pospay/ui';
import type { ActionState } from '../model/statement-display';

/** زرار أمر على الكشف: مخفي لو الحالة ما بتسمحش بيه، ومقفول لو ظاهر لسبب قدام المستخدم. */
export function StatementActionButton({
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
