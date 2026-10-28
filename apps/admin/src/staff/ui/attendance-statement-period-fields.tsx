'use client';
import { t, type Locale, type MessageKey } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import type { StatementDraft, StatementDraftPatch } from '../model/attendance-statement-display';

const RADIO_CLASS = 'h-4 w-4 min-h-0 ps-0 pe-0 py-0';

const MODE_OPTIONS = [
  { value: 'month', label: 'attendanceStatementScreen.periodMonth' },
  { value: 'custom', label: 'attendanceStatementScreen.periodCustom' },
] as const satisfies readonly { value: 'month' | 'custom'; label: MessageKey }[];

/** اختيار طريقة الفترة: شهر جاهز أو من/إلى. */
function periodRadios(
  mode: 'month' | 'custom',
  onChange: (patch: StatementDraftPatch) => void,
  locale: Locale,
) {
  return (
    <>
      {MODE_OPTIONS.map((option) => (
        <label key={option.value} className="flex items-center gap-2 text-sm">
          <Input
            id={`statement-period-${option.value}`}
            name="statement-period"
            type="radio"
            className={RADIO_CLASS}
            checked={mode === option.value}
            onChange={() => onChange({ periodMode: option.value })}
          />
          {t(locale, option.label)}
        </label>
      ))}
    </>
  );
}

/** حقول الفترة: شهر جاهز أو من/إلى — والشاشة بتعرض رسالة فحص مبدئي لو الفترة مش صالحة (Story 3.4). */
export function AttendanceStatementPeriodFields(props: {
  draft: StatementDraft;
  valid: boolean;
  onChange: (patch: StatementDraftPatch) => void;
}) {
  const locale = useLocale();
  const { draft } = props;
  return (
    <fieldset className="grid gap-2">
      <legend className="text-start text-sm font-medium">
        {t(locale, 'attendanceStatementScreen.period')}
      </legend>
      {periodRadios(draft.periodMode, props.onChange, locale)}
      {draft.periodMode === 'month' ? (
        <div className="grid gap-1">
          <Label htmlFor="statement-month">{t(locale, 'attendanceStatementScreen.month')}</Label>
          <Input
            id="statement-month"
            type="month"
            value={draft.month}
            onChange={(event) => props.onChange({ month: event.target.value })}
          />
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <Label htmlFor="statement-from">{t(locale, 'attendanceStatementScreen.from')}</Label>
            <Input
              id="statement-from"
              type="date"
              value={draft.from}
              onChange={(event) => props.onChange({ from: event.target.value })}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="statement-to">{t(locale, 'attendanceStatementScreen.to')}</Label>
            <Input
              id="statement-to"
              type="date"
              value={draft.to}
              onChange={(event) => props.onChange({ to: event.target.value })}
            />
          </div>
        </div>
      )}
      {props.valid ? null : (
        <p className="text-sm text-destructive">{t(locale, 'attendanceStatementScreen.periodInvalid')}</p>
      )}
    </fieldset>
  );
}
