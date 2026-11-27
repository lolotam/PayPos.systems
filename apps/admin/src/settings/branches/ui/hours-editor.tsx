'use client';

import { useState } from 'react';
import type { Branch, OpeningHours } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import {
  draftEquals,
  draftFromHours,
  draftProblem,
  payloadFromDraft,
  WEEKDAYS,
  WEEKDAY_LABEL_KEYS,
  type DraftProblem,
  type HoursDraft,
} from '../model/hours-draft';
import { HoursDayRow } from './hours-day-row';

interface EditorProps {
  readonly branch: Branch;
  readonly saving: boolean;
  readonly failure: string | null;
  readonly result: 'saved' | 'cleared' | null;
  readonly onSave: (hours: OpeningHours | null, onSaved?: () => void) => void;
}

function problemText(problem: DraftProblem, locale: Locale): string {
  if (problem.kind === 'overlap') return t(locale, 'branchHours.overlap');
  const day = t(locale, WEEKDAY_LABEL_KEYS[problem.weekday] ?? 'branchHours.monday');
  return t(
    locale,
    problem.kind === 'incomplete' ? 'branchHours.incomplete' : 'branchHours.sameTimes',
  ).replace('{day}', day);
}

function Notices({
  problem,
  failure,
  result,
  dirty,
  saving,
}: {
  problem: DraftProblem | null;
  failure: string | null;
  result: 'saved' | 'cleared' | null;
  dirty: boolean;
  saving: boolean;
}) {
  const locale = useLocale();
  return (
    <>
      {problem ? <p role="alert">{problemText(problem, locale)}</p> : null}
      {failure ? <p role="alert">{failure}</p> : null}
      {result && !dirty ? (
        <p role="status">
          {t(locale, result === 'saved' ? 'branchHours.saved' : 'branchHours.cleared')}
        </p>
      ) : null}
      {dirty && !saving ? (
        <p className="text-sm text-muted-foreground">{t(locale, 'branchHours.dirtyNote')}</p>
      ) : null}
    </>
  );
}

function EditorActions({
  canSave,
  saving,
  hasStored,
  onSaveDraft,
  onClear,
}: {
  canSave: boolean;
  saving: boolean;
  hasStored: boolean;
  onSaveDraft: () => void;
  onClear: () => void;
}) {
  const locale = useLocale();
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={!canSave} onClick={onSaveDraft}>
        {t(locale, saving ? 'branchHours.saving' : 'branchHours.save')}
      </Button>
      {hasStored ? (
        <Button type="button" variant="outline" disabled={saving} onClick={onClear}>
          {t(locale, 'branchHours.clear')}
        </Button>
      ) : null}
    </div>
  );
}

/** محرر مواعيد الفرع: المسودة محلية، والحفظ بيبعت الأسبوع كامل، ومسح المواعيد بيبعت null. */
export function HoursEditor({ branch, saving, failure, result, onSave }: EditorProps) {
  const locale = useLocale();
  const stored = branch.opening_hours;
  const baseline = draftFromHours(stored);
  const [lastBaseline, setLastBaseline] = useState<HoursDraft>(baseline);
  const [draft, setDraft] = useState<HoursDraft>(baseline);
  if (!draftEquals(baseline, lastBaseline)) {
    setLastBaseline(baseline);
    if (draftEquals(draft, lastBaseline)) setDraft(baseline);
  }
  const problem = draftProblem(draft);
  const dirty = !draftEquals(draft, baseline);
  const canSave = !saving && problem === null && (dirty || stored === null);
  const resetEmpty = () => {
    const empty = draftFromHours(null);
    setLastBaseline(empty);
    setDraft(empty);
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{branch.name_ar ?? branch.name_en}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {t(locale, 'branchHours.timeZone').replace('{zone}', branch.effective_timezone)}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {stored?.length === 0 ? <p>{t(locale, 'branchHours.closedAllWeek')}</p> : null}
        {stored === null ? <p>{t(locale, 'branchHours.noHours')}</p> : null}
        <ul>
          {WEEKDAYS.map((weekday) => (
            <HoursDayRow
              key={weekday}
              weekday={weekday}
              intervals={draft[weekday] ?? []}
              disabled={saving}
              onChange={(intervals) => setDraft({ ...draft, [weekday]: intervals })}
            />
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">{t(locale, 'branchHours.overnightHint')}</p>
        <Notices
          problem={problem}
          failure={failure}
          result={result}
          dirty={dirty}
          saving={saving}
        />
        <EditorActions
          canSave={canSave}
          saving={saving}
          hasStored={stored !== null}
          onSaveDraft={() => onSave(payloadFromDraft(draft))}
          onClear={() => onSave(null, resetEmpty)}
        />
      </CardContent>
    </Card>
  );
}
