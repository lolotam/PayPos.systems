export function sessionLocalTime(instant: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}:${value('second')}`;
}

type TimeResult = { instant: string | undefined; error?: never }
  | { error: 'invalidTime' | 'nonexistentTime' | 'ambiguousTime'; instant?: never };

export function sessionUtc(value: string, timezone: string): TimeResult {
  if (!value) return { instant: undefined };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return { error: 'invalidTime' };
  const local = value.length === 16 ? `${value}:00` : value, wall = Date.parse(`${local}Z`);
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 19) !== local) return { error: 'invalidTime' };
  const offsets = new Set<number>();
  // نفحص الإزاحات على جانبي انتقال التوقيت؛ اختيار لحظة من ساعة مكررة ممكن يغيّر يوم الخدمة.
  for (const hours of [-36, -12, 0, 12, 36]) {
    const sample = wall + hours * 3_600_000;
    offsets.add(Date.parse(`${sessionLocalTime(new Date(sample).toISOString(), timezone)}Z`) - sample);
  }
  const matches = [...offsets].map((offset) => wall - offset)
    .filter((candidate) => sessionLocalTime(new Date(candidate).toISOString(), timezone) === local);
  if (matches.length !== 1) return { error: matches.length ? 'ambiguousTime' : 'nonexistentTime' };
  return { instant: new Date(matches[0] as number).toISOString() };
}

export function sessionOldestLocal(now: string, timezone: string): string {
  const local = sessionLocalTime(now, timezone), year = Number(local.slice(0, 4)), month = Number(local.slice(5, 7));
  return `${String(month === 1 ? year - 1 : year).padStart(4, '0')}-${String(month === 1 ? 12 : month - 1).padStart(2, '0')}-01T00:00:00`;
}
