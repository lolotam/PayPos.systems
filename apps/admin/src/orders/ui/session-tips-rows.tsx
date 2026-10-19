'use client';
import type { RecordSessionTipsInput } from '@pospay/contracts';
import type { Locale } from '@pospay/i18n';
import { useWatch, type UseFormReturn } from 'react-hook-form';
import type { SessionTipFormInput, TipAmountRow } from '../model/session-tip-body';
import { performerLabel, tipPeople, type TipSourceLine } from '../model/session-tip-source';
import { SessionTipRow } from './session-tip-row';

function rowIds(rows: TipAmountRow[] | undefined) {
  return (rows ?? []).map((row) => ({ employee_id: row.employee_id }));
}

export function SessionTipsRows({
  form,
  locale,
  lines,
  locked,
}: {
  form: UseFormReturn<SessionTipFormInput, unknown, RecordSessionTipsInput>;
  locale: Locale;
  lines: readonly TipSourceLine[];
  locked: boolean;
}) {
  const rows = useWatch({ control: form.control, name: 'rows' });
  const people = new Map(
    tipPeople(lines, rowIds(rows)).map((person) => [person.employee_id, person]),
  );
  return (
    <div className="grid gap-3">
      {(rows ?? []).map((row, index) => {
        const person = people.get(row.employee_id.toLowerCase());
        const label = person ? performerLabel(locale, person) : row.employee_id;
        return (
          <SessionTipRow
            key={row.employee_id}
            form={form}
            index={index}
            label={label}
            locale={locale}
            locked={locked}
          />
        );
      })}
    </div>
  );
}
