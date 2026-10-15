import { ScheduleError } from './schedule-types.ts';
const DAY_MS = 86_400_000;
const OFFSET_PROBES_MS = [-36, -24, -12, 0, 12, 24, 36].map((hours) => hours * 3_600_000);
const PARTS_LIMIT = 16_384;
const APPLY_ROOM = 4_096;
const WALL_CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
const WALL_PARTS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
};
// خيارات التنسيق ثابتة، وبناء Intl.DateTimeFormat لكل لحظة يتجاوز ميزانية تطبيق القالب.
const formatters = new Map<string, Intl.DateTimeFormat>();
type CachedWall = { wall: string; epoch: number };
// اللحظة نفسها تُسأل أكثر من مرة على خطوات ±12 ساعة، والناتج دالة من المنطقة واللحظة فقط.
// السقف يحد الذاكرة، والمسح يسبق الامتلاء بهامش يكفي تطبيق عشرة أسابيع حتى لا يُعاد حسابه في منتصفه.
const partsByZone = new Map<string, Map<number, CachedWall>>();
let partsCount = 0;

/**
 * يضيف أياماً مدنية دون الاعتماد على توقيت الخادم أو طول يوم التوقيت الصيفي.
 *
 * @param date التاريخ الميلادي
 * @param days عدد الأيام
 * @returns التاريخ المدني الناتج
 */
export function addScheduleDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}
/**
 * يرفض أسبوعاً لا يبدأ السبت حتى تتفق شاشة المدير وتقارير الحضور على حدود الأسبوع.
 *
 * @param weekStart يوم البداية
 * @returns لا قيمة؛ يرمي الخطأ المسمى عند الرفض
 */
export function validateScheduleWeek(weekStart: string): void {
  const at = new Date(`${weekStart}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(weekStart) ||
    !Number.isFinite(at.getTime()) ||
    at.toISOString().slice(0, 10) !== weekStart ||
    at.getUTCDay() !== 6
  )
    throw new ScheduleError('SCHEDULE_WEEK_INVALID');
}
function localFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timezone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-CA', { ...WALL_PARTS, timeZone: timezone });
  formatters.set(timezone, formatter);
  return formatter;
}
function wallFromParts(at: number, formatter: Intl.DateTimeFormat): string {
  const parts = formatter.formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
}
function formatLocalParts(at: number, formatter: Intl.DateTimeFormat): CachedWall {
  // en-CA مع هذه الخيارات يطبع التاريخ ثم فاصلة؛ استبدالها يطابق formatToParts دون بناء المصفوفة.
  const formatted = formatter.format(at).replace(', ', 'T');
  const wall = WALL_CLOCK.test(formatted) ? formatted : wallFromParts(at, formatter);
  return { wall, epoch: Date.parse(`${wall}Z`) };
}
function localParts(timezone: string, at: number, formatter: Intl.DateTimeFormat): CachedWall {
  const hit = partsByZone.get(timezone)?.get(at);
  if (hit !== undefined) return hit;
  const value = formatLocalParts(at, formatter);
  if (partsCount > PARTS_LIMIT - APPLY_ROOM) {
    partsByZone.clear();
    partsCount = 0;
  }
  let zoneParts = partsByZone.get(timezone);
  if (!zoneParts) {
    zoneParts = new Map();
    partsByZone.set(timezone, zoneParts);
  }
  zoneParts.set(at, value);
  partsCount += 1;
  return value;
}
/**
 * يحول ساعة الفرع للحظة UTC فريدة؛ رفض فجوة أو تكرار الساعة يحمي المدة من اختيار صامت.
 * خيارات التنسيق ثابتة، فمُنسّق المنطقة يُعاد استخدامه والناتج يطابق منشئًا جديدًا لكل لحظة.
 *
 * @param date يوم البداية المحلي
 * @param time الساعة المحلية
 * @param timezone منطقة الفرع المحلولة
 * @returns لحظة UTC بصيغة ISO
 */
export function scheduleInstant(date: string, time: string, timezone: string): string {
  const wall = `${date}T${time}:00`;
  const nominal = Date.parse(`${wall}Z`);
  const matches = new Set<number>();
  try {
    const formatter = localFormatter(timezone);
    for (const probe of OFFSET_PROBES_MS) {
      const sample = nominal + probe;
      const offset = localParts(timezone, sample, formatter).epoch - sample;
      const candidate = nominal - offset;
      if (localParts(timezone, candidate, formatter).wall === wall) matches.add(candidate);
    }
  } catch {
    throw new ScheduleError('SCHEDULE_LOCAL_TIME_INVALID');
  }
  // TODO(spec) SC-Q2: تأكيد رفض الساعة المكررة أو غير الموجودة بدلاً من اختيار offset تلقائي.
  if (matches.size !== 1) throw new ScheduleError('SCHEDULE_LOCAL_TIME_INVALID');
  const [unique] = matches;
  if (unique === undefined) throw new ScheduleError('SCHEDULE_LOCAL_TIME_INVALID');
  return new Date(unique).toISOString();
}
/**
 * تاريخ اليوم مصدره ساعة محقونة ومنطقة الفرع، فلا يتغير شرط السبب مع مكان المدير.
 * نفس مُنسّق المنطقة المحفوظ يُستخدم هنا، واليوم المحلي يطابق منشئًا جديدًا.
 *
 * @param now اللحظة المحقونة
 * @param timezone المنطقة المحلولة
 * @returns اليوم المحلي
 */
export function scheduleToday(now: Date, timezone: string): string {
  return localParts(timezone, now.getTime(), localFormatter(timezone)).wall.slice(0, 10);
}
