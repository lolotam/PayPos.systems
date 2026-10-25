import type { BootstrapParams } from './bootstrap-rating-requests.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const PAGE_SIZE = /^\d{1,3}$/;
const FLAGS = new Set(
  '--company --cutoff --checkpoint --max-session-id --recorded-before --page-size'.split(' '),
);

/** مدخل غلط من المشغّل: كل الحالات بتطلع بنفس الرمز. */
export function invalidArgument(): Error {
  return new Error('BOOTSTRAP_ARGUMENT_INVALID');
}

export function uuidOf(value: string | undefined): string | undefined {
  if (value !== undefined && !UUID.test(value)) throw invalidArgument();
  return value;
}

/**
 * يقرأ لحظة ISO ويتأكد إن تاريخها موجود في التقويم: 30 فبراير بتتدحرج لـ 2 مارس في `new Date`
 * من غير ما تحس، فوقت قطع غلط كان هيتعدّى على زيارات مستحقة ويقول إن التغطية كاملة.
 */
export function instantOf(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const parts = INSTANT.exec(value);
  if (parts === null) throw invalidArgument();
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const hour = Number(parts[4]);
  const minute = Number(parts[5]);
  const second = parts[6] === undefined ? 0 : Number(parts[6]);
  if (hour > 23 || minute > 59 || second > 59) throw invalidArgument();
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day
  )
    throw invalidArgument();
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw invalidArgument();
  return instant;
}

export function readArguments(argv: readonly string[]): BootstrapParams {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || value === undefined || !FLAGS.has(flag) || values.has(flag))
      throw invalidArgument();
    values.set(flag, value);
  }
  const companyId = uuidOf(values.get('--company'));
  const cutoff = instantOf(values.get('--cutoff'));
  if (companyId === undefined || cutoff === undefined) throw invalidArgument();
  const checkpoint = uuidOf(values.get('--checkpoint'));
  const maxSessionId = uuidOf(values.get('--max-session-id'));
  const recordedBefore = instantOf(values.get('--recorded-before'));
  const pageSize = values.get('--page-size');
  if (pageSize !== undefined && !PAGE_SIZE.test(pageSize)) throw invalidArgument();
  const size = pageSize === undefined ? undefined : Number(pageSize);
  if (size !== undefined && (size < 1 || size > 200)) throw invalidArgument();
  return {
    companyId,
    cutoff,
    ...(checkpoint === undefined ? {} : { checkpoint }),
    ...(maxSessionId === undefined ? {} : { maxSessionId }),
    ...(recordedBefore === undefined ? {} : { recordedAtOrBefore: recordedBefore }),
    ...(size === undefined ? {} : { pageSize: size }),
  };
}
