import type { SessionTipEntry } from '@pospay/contracts';
import {
  parseMoney,
  performerNetWeights,
  suggestTipSplit,
  sumMoney,
  type TipSuggestion,
  type TipWeightLine,
} from '@pospay/domain';
import type { Locale } from '@pospay/i18n';

export type TipSourcePerformer = {
  employee_id: string;
  share_bps: number;
  name_ar: string | null;
  name_en: string;
};

export type TipSourceLine = {
  status: 'ACTIVE' | 'CANCELLED';
  net: string;
  performers: readonly TipSourcePerformer[];
};

export type TipPerson = {
  employee_id: string;
  name_ar: string | null;
  name_en: string;
};

export function byEmployeeId(left: string, right: string): number {
  const lowerLeft = left.toLowerCase();
  const lowerRight = right.toLowerCase();
  return lowerLeft < lowerRight ? -1 : lowerLeft > lowerRight ? 1 : 0;
}

export function performerLabel(locale: Locale, person: TipPerson): string {
  if (locale === 'ar') return person.name_ar ?? person.name_en;
  return person.name_en;
}

function weightLines(lines: readonly TipSourceLine[]): TipWeightLine[] {
  return lines.map((line) => ({
    status: line.status,
    net: parseMoney(line.net),
    performers: line.performers.map((performer) => ({
      employee_id: performer.employee_id,
      share_bps: performer.share_bps,
    })),
  }));
}

export function visitTipWeights(lines: readonly TipSourceLine[]) {
  try {
    return { ok: true as const, weights: performerNetWeights(weightLines(lines)) };
  } catch (error) {
    if (error instanceof RangeError) return { ok: false as const, weights: [] };
    throw error;
  }
}

export function visitNetMills(lines: readonly TipSourceLine[]): bigint {
  return sumMoney(
    lines.filter((line) => line.status === 'ACTIVE').map((line) => parseMoney(line.net)),
  );
}

function namesOf(lines: readonly TipSourceLine[]) {
  const names = new Map<string, { name_ar: string | null; name_en: string }>();
  for (const line of lines) {
    for (const performer of line.performers) {
      names.set(performer.employee_id.toLowerCase(), {
        name_ar: performer.name_ar,
        name_en: performer.name_en,
      });
    }
  }
  return names;
}

export function tipPeople(
  lines: readonly TipSourceLine[],
  tips: readonly Pick<SessionTipEntry, 'employee_id'>[],
): TipPerson[] {
  const names = namesOf(lines);
  const weighed = visitTipWeights(lines);
  const ids = new Set<string>(weighed.ok ? weighed.weights.map((row) => row.employee_id) : []);
  if (!weighed.ok) {
    for (const line of lines) {
      if (line.status !== 'ACTIVE') continue;
      for (const performer of line.performers) ids.add(performer.employee_id.toLowerCase());
    }
  }
  for (const tip of tips) ids.add(tip.employee_id.toLowerCase());
  return [...ids].sort(byEmployeeId).map((employee_id) => ({
    employee_id,
    name_ar: names.get(employee_id)?.name_ar ?? null,
    name_en: names.get(employee_id)?.name_en ?? employee_id,
  }));
}

/** الاقتراح من النواة. null يعني إن الوزن أو المبلغ مش قابل للتقسيم، والقائمة الفاضية تعني مفيش منفّذة. */
export function suggestedTipSplit(
  tip: bigint,
  lines: readonly TipSourceLine[],
): TipSuggestion[] | null {
  if (tip <= 0n) return [];
  const weighed = visitTipWeights(lines);
  if (!weighed.ok) return null;
  try {
    return suggestTipSplit(tip, weighed.weights);
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}
