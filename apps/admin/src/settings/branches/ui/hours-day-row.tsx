'use client';

import { t } from '@pospay/i18n';
import { Button, Input } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import {
  DEFAULT_INTERVAL,
  MAX_INTERVALS_PER_DAY,
  WEEKDAY_LABEL_KEYS,
  type IntervalDraft,
} from '../model/hours-draft';

interface DayRowProps {
  readonly weekday: number;
  readonly intervals: readonly IntervalDraft[];
  readonly onChange: (intervals: readonly IntervalDraft[]) => void;
}

function IntervalRow({
  day,
  index,
  interval,
  onChange,
  onRemove,
}: {
  day: string;
  index: number;
  interval: IntervalDraft;
  onChange: (change: Partial<IntervalDraft>) => void;
  onRemove: () => void;
}) {
  const locale = useLocale();
  return (
    <div className="flex flex-wrap items-end gap-3 ps-8">
      <label className="flex flex-col gap-1 text-sm">
        {t(locale, 'branchHours.opens')}
        <Input
          type="time"
          dir="ltr"
          value={interval.opens}
          aria-label={`${day} ${t(locale, 'branchHours.opens')} ${index + 1}`}
          onChange={(event) => onChange({ opens: event.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t(locale, 'branchHours.closes')}
        <Input
          type="time"
          dir="ltr"
          value={interval.closes}
          aria-label={`${day} ${t(locale, 'branchHours.closes')} ${index + 1}`}
          onChange={(event) => onChange({ closes: event.target.value })}
        />
      </label>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-label={`${day}: ${t(locale, 'branchHours.removeInterval')} ${index + 1}`}
        onClick={onRemove}
      >
        {t(locale, 'branchHours.removeInterval')}
      </Button>
    </div>
  );
}

/** يوم واحد من الأسبوع: مفتوح أو قافل، ولما يكون مفتوح فترة أو أكتر بوقت فتح ووقت قفل. */
export function HoursDayRow({ weekday, intervals, onChange }: DayRowProps) {
  const locale = useLocale();
  const day = t(locale, WEEKDAY_LABEL_KEYS[weekday] ?? 'branchHours.monday');
  const open = intervals.length > 0;
  const setAt = (index: number, change: Partial<IntervalDraft>) =>
    onChange(intervals.map((item, at) => (at === index ? { ...item, ...change } : item)));
  return (
    <li className="flex flex-col gap-2 border-b border-border py-3 last:border-b-0">
      <label className="flex items-center gap-3 font-semibold">
        <input
          type="checkbox"
          className="size-5"
          checked={open}
          aria-label={`${day}: ${t(locale, 'branchHours.open')}`}
          onChange={(event) => onChange(event.target.checked ? [DEFAULT_INTERVAL] : [])}
        />
        <span>{day}</span>
        <span className="text-sm font-normal text-muted-foreground">
          {t(locale, open ? 'branchHours.open' : 'branchHours.closed')}
        </span>
      </label>
      {intervals.map((interval, index) => (
        <IntervalRow
          key={`${weekday}-${index}`}
          day={day}
          index={index}
          interval={interval}
          onChange={(change) => setAt(index, change)}
          onRemove={() => onChange(intervals.filter((_, at) => at !== index))}
        />
      ))}
      {open && intervals.length < MAX_INTERVALS_PER_DAY ? (
        <div className="ps-8">
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={`${day}: ${t(locale, 'branchHours.addInterval')}`}
            onClick={() => onChange([...intervals, DEFAULT_INTERVAL])}
          >
            {t(locale, 'branchHours.addInterval')}
          </Button>
        </div>
      ) : null}
    </li>
  );
}
