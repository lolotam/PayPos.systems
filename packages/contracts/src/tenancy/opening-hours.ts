import { z } from 'zod';

const MINUTES_PER_DAY = 24 * 60;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM, 00:00–23:59');

const toMinutes = (value: string): number => {
  const [hours = '0', minutes = '0'] = value.split(':');
  return Number(hours) * 60 + Number(minutes);
};

// فترة closes أصغر من opens معناها إنها بتعدّي نص الليل (18:00–02:00). opens = closes مرفوض
// لأنه ممكن يتفهم صفر أو 24 ساعة.
export const openingInterval = z
  .object({ opens: clock, closes: clock })
  .refine((interval) => interval.opens !== interval.closes, {
    message: 'opens and closes must differ',
  });

// الأيام بترقيم ISO 8601: 1 = الاتنين … 7 = الحد. يوم مش موجود = الفرع قافل فيه.
export const openingDay = z.object({
  weekday: z.number().int().min(1).max(7),
  intervals: z.array(openingInterval).min(1).max(6),
});

interface Span {
  start: number;
  end: number;
}

// كل الفترات بتتحط على خط الأسبوع؛ فترة بعد نص الليل ممكن تتداخل مع أول فترة في اليوم اللي بعده،
// وفترة الحد بعد نص الليل بتلف على الاتنين.
function weeklySpans(days: readonly z.infer<typeof openingDay>[]): Span[] {
  const spans: Span[] = [];
  for (const day of days) {
    const base = (day.weekday - 1) * MINUTES_PER_DAY;
    for (const { opens, closes } of day.intervals) {
      const start = base + toMinutes(opens);
      let end = base + toMinutes(closes);
      if (end <= start) end += MINUTES_PER_DAY;
      spans.push({ start, end });
      if (end > MINUTES_PER_WEEK) spans.push({ start: 0, end: end - MINUTES_PER_WEEK });
    }
  }
  return spans;
}

// بنقارن بأبعد نهاية لحد دلوقتي، مش بالفترة اللي قبلها بس — فترة طويلة ممكن تغطي أكتر من فترة بعدها.
function hasOverlap(spans: Span[]): boolean {
  let furthestEnd = -1;
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    if (span.start < furthestEnd) return true;
    furthestEnd = Math.max(furthestEnd, span.end);
  }
  return false;
}

// فترات مواعيد عمل الفرع لكل يوم (قرار Waleed 2026-09-23): فترة أو أكتر لكل يوم، ومفيش تداخل.
export const openingHours = z
  .array(openingDay)
  .max(7)
  .refine((days) => new Set(days.map((day) => day.weekday)).size === days.length, {
    message: 'Each weekday may appear once',
  })
  .refine((days) => !hasOverlap(weeklySpans(days)), {
    message: 'Opening intervals overlap',
  })
  .meta({ id: 'OpeningHours' });

export type OpeningHours = z.infer<typeof openingHours>;
