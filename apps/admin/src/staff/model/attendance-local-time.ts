function civilParts(instant: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}:${value('second')}`;
}
export function attendanceLocalTime(instant: string, timezone: string) {
  return civilParts(new Date(instant), timezone);
}

// عند تكرار الساعة بسبب التوقيت الصيفي نختار الإزاحة التي تعطي اللحظة الأسبق، ونرفض الساعة غير الموجودة.
export function attendanceUtc(value: string, timezone: string): string | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return '';
  const local = value.length === 16 ? `${value}:00` : value;
  const wall = Date.parse(`${local}Z`);
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 19) !== local) return '';
  const offsets = new Set<number>();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const sample = wall + hours * 3_600_000;
    offsets.add(Date.parse(`${civilParts(new Date(sample), timezone)}Z`) - sample);
  }
  const matches = [...offsets]
    .map((offset) => wall - offset)
    .filter((candidate) => civilParts(new Date(candidate), timezone) === local);
  return matches.length > 0 ? new Date(Math.min(...matches)).toISOString() : '';
}
