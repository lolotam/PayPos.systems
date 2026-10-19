'use client';
import type { RecordSessionTipsInput } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import type { UseFormReturn } from 'react-hook-form';
import type { SessionTipFormInput } from '../model/session-tip-body';

export function SessionTipRow({
  form,
  index,
  label,
  locale,
  locked,
}: {
  form: UseFormReturn<SessionTipFormInput, unknown, RecordSessionTipsInput>;
  index: number;
  label: string;
  locale: Locale;
  locked: boolean;
}) {
  const cash = form.register(`rows.${index}.cash`);
  const card = form.register(`rows.${index}.card`);
  const cashLabel = `${label} ${t(locale, 'sessionTips.cashAmount')}`;
  const cardLabel = `${label} ${t(locale, 'sessionTips.cardAmount')}`;
  return (
    <fieldset className="grid gap-2 border-0 p-0" disabled={locked}>
      <legend className="font-medium">{label}</legend>
      <Label htmlFor={`tip-cash-${index}`}>{cashLabel}</Label>
      <Input id={`tip-cash-${index}`} inputMode="decimal" aria-label={cashLabel} {...cash} />
      <Label htmlFor={`tip-card-${index}`}>{cardLabel}</Label>
      <Input id={`tip-card-${index}`} inputMode="decimal" aria-label={cardLabel} {...card} />
    </fieldset>
  );
}
