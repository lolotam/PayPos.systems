import { openingHours, type OpeningHours } from '@pospay/contracts';
import type { MessageKey } from '@pospay/i18n';

/** الأيام بترقيم ISO 8601 زي العقد: 1 = الاتنين … 7 = الحد. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export const MAX_INTERVALS_PER_DAY = 6;

export interface IntervalDraft {
  readonly opens: string;
  readonly closes: string;
}

/** مسودة الأسبوع: مصفوفة فترات لكل يوم، والمصفوفة الفاضية معناها «قافل». */
export type HoursDraft = Readonly<Record<number, readonly IntervalDraft[]>>;

export const DEFAULT_INTERVAL: IntervalDraft = { opens: '09:00', closes: '17:00' };

export const WEEKDAY_LABEL_KEYS: Record<number, MessageKey> = {
  1: 'branchHours.monday',
  2: 'branchHours.tuesday',
  3: 'branchHours.wednesday',
  4: 'branchHours.thursday',
  5: 'branchHours.friday',
  6: 'branchHours.saturday',
  7: 'branchHours.sunday',
};

/** مشكلة في المسودة قبل الإرسال: يوم محدد، أو تداخل بين الفترات. */
export type DraftProblem =
  | { readonly kind: 'incomplete' | 'sameTimes'; readonly weekday: number }
  | { readonly kind: 'overlap' };

export function draftFromHours(hours: OpeningHours | null): HoursDraft {
  const draft: Record<number, readonly IntervalDraft[]> = {};
  for (const weekday of WEEKDAYS) draft[weekday] = [];
  for (const day of hours ?? []) {
    draft[day.weekday] = day.intervals.map(({ opens, closes }) => ({ opens, closes }));
  }
  return draft;
}

export function payloadFromDraft(draft: HoursDraft): OpeningHours {
  return WEEKDAYS.flatMap((weekday) => {
    const intervals = draft[weekday] ?? [];
    return intervals.length === 0 ? [] : [{ weekday, intervals: [...intervals] }];
  });
}

/** أول مشكلة بتمنع الحفظ، بنفس قواعد العقد اللي الخادم بيفرضها (التداخل بيتفحص بالعقد نفسه). */
export function draftProblem(draft: HoursDraft): DraftProblem | null {
  for (const weekday of WEEKDAYS) {
    for (const interval of draft[weekday] ?? []) {
      if (interval.opens === '' || interval.closes === '') return { kind: 'incomplete', weekday };
      if (interval.opens === interval.closes) return { kind: 'sameTimes', weekday };
    }
  }
  return openingHours.safeParse(payloadFromDraft(draft)).success ? null : { kind: 'overlap' };
}

/** هل المسودة اختلفت عن اللي اتحمّل من الخادم، بصرف النظر عن ترتيب الكتابة. */
export function draftEquals(a: HoursDraft, b: HoursDraft): boolean {
  return JSON.stringify(payloadFromDraft(a)) === JSON.stringify(payloadFromDraft(b));
}
