'use client';
import type { TipSuggestion } from '@pospay/domain';
import { formatKwd, t, type Locale } from '@pospay/i18n';
import { performerLabel, tipPeople, type TipSourceLine } from '../model/session-tip-source';

export function SessionTipsSuggestionList(props: {
  locale: Locale;
  lines: readonly TipSourceLine[];
  suggestion: readonly TipSuggestion[];
}) {
  const people = new Map(
    tipPeople(props.lines, props.suggestion).map((person) => [person.employee_id, person]),
  );
  return (
    <ul aria-label={t(props.locale, 'sessionTips.suggestion')} className="grid gap-1">
      {props.suggestion.map((row) => {
        const person = people.get(row.employee_id);
        const label = person ? performerLabel(props.locale, person) : row.employee_id;
        return (
          <li key={row.employee_id}>
            {label} <bdi>{formatKwd(row.amount)}</bdi>
          </li>
        );
      })}
    </ul>
  );
}
