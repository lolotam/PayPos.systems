'use client';
import type { RecordSessionTipsInput } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Button, Input, Label, NativeSelect } from '@pospay/ui';
import { useWatch, type UseFormReturn } from 'react-hook-form';
import {
  previewSuggestion,
  rowsUsingSuggestion,
  type SessionTipFormInput,
  type TipAmountRow,
} from '../model/session-tip-body';
import type { TipSourceLine } from '../model/session-tip-source';
import { SessionTipsMethodTotals } from './session-tips-method-totals';
import { SessionTipsSuggestionList } from './session-tips-suggestion-list';

function completeRows(rows: SessionTipFormInput['rows'] | undefined): TipAmountRow[] {
  return (rows ?? []).map((row) => ({
    employee_id: row.employee_id,
    cash: row.cash ?? '',
    card: row.card ?? '',
  }));
}

export function SessionTipsSuggestion({
  form,
  locale,
  lines,
  locked,
  exact,
  netsKnown,
}: {
  form: UseFormReturn<SessionTipFormInput, unknown, RecordSessionTipsInput>;
  locale: Locale;
  lines: readonly TipSourceLine[];
  locked: boolean;
  exact: boolean;
  netsKnown: boolean;
}) {
  const total = useWatch({ control: form.control, name: 'total' }) ?? '';
  const method = useWatch({ control: form.control, name: 'suggestion_method' }) ?? 'CASH';
  const rows = completeRows(useWatch({ control: form.control, name: 'rows' }));
  const preview = previewSuggestion(total, rows, lines);
  const suggestion = netsKnown && preview.status === 'ready' ? preview.rows : [];
  const totalField = form.register('total');
  const methodField = form.register('suggestion_method');
  const apply = () => {
    if (locked || suggestion.length === 0) return;
    form.setValue('rows', rowsUsingSuggestion(rows, suggestion, method, exact), {
      shouldDirty: true,
    });
  };
  return (
    <div className="grid gap-2">
      <Label htmlFor="tip-total">{t(locale, 'sessionTips.total')}</Label>
      <Input id="tip-total" inputMode="decimal" disabled={locked} {...totalField} />
      <Label htmlFor="tip-method">{t(locale, 'sessionTips.method')}</Label>
      <NativeSelect
        id="tip-method"
        aria-label={t(locale, 'sessionTips.method')}
        disabled={locked}
        {...methodField}
      >
        <option value="CASH">{t(locale, 'sessionTips.cash')}</option>
        <option value="CARD">{t(locale, 'sessionTips.card')}</option>
      </NativeSelect>
      <SessionTipsSuggestionList locale={locale} lines={lines} suggestion={suggestion} />
      <Button
        type="button"
        variant="outline"
        disabled={locked || suggestion.length === 0}
        onClick={apply}
      >
        {t(locale, 'sessionTips.useSuggestion')}
      </Button>
      <SessionTipsMethodTotals locale={locale} rows={rows} lines={lines} netsKnown={netsKnown} />
    </div>
  );
}
