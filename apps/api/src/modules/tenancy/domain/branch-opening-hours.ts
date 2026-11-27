const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const intervalText = (interval: unknown): string =>
  isRecord(interval) &&
  typeof interval['opens'] === 'string' &&
  typeof interval['closes'] === 'string'
    ? `${interval['opens']}-${interval['closes']}`
    : JSON.stringify(interval);

function dayEntry(day: unknown): { readonly weekday: number; readonly text: string } {
  if (isRecord(day) && typeof day['weekday'] === 'number' && Array.isArray(day['intervals'])) {
    const intervals = day['intervals'].map(intervalText).sort().join(',');
    return { weekday: day['weekday'], text: `${day['weekday']}:${intervals}` };
  }
  return { weekday: Number.MAX_SAFE_INTEGER, text: JSON.stringify(day) };
}

/**
 * بيحوّل مواعيد عمل الفرع لنص ثابت لا يتأثر بترتيب الأيام ولا ترتيب الفترات ولا ترتيب مفاتيح الكائن
 * (jsonb بيعيد ترتيب المفاتيح عند التخزين)، عشان المقارنة تعتمد على المعنى مش على شكل الكتابة.
 * `null` («مفيش مواعيد») و`[]` («قافل كل الأسبوع») قيمتان مختلفتان، وأي شكل قديم مش مصفوفة بيتقارن بنصه الخام.
 *
 * @param value المواعيد كما اتخزنت أو كما وصلت من العقد، أو `null`
 * @returns نص قانوني يتساوى لما تكون المواعيد متطابقة المعنى
 */
export function canonicalOpeningHours(value: unknown): string {
  if (!Array.isArray(value)) return JSON.stringify(value ?? null);
  const days = value
    .map(dayEntry)
    .sort((a, b) => a.weekday - b.weekday || a.text.localeCompare(b.text));
  return `week:${days.map((day) => day.text).join('|')}`;
}

/**
 * بيقرر تعديل مواعيد عمل الفرع قبل أي كتابة: التغيير يحصل فقط لو المعنى المخزّن مختلف عن المطلوب، فإعادة
 * إرسال نفس المواعيد (حتى بترتيب مختلف) ما بتكتبش ولا بتتدوّن.
 *
 * @param stored المواعيد المخزّنة كما وصلت من الصف المقفول، أو `null`
 * @param requested المواعيد الجديدة المتحقق منها من العقد، أو `null` لمسحها
 * @returns هل فيه تغيير فعلي
 */
export function planBranchOpeningHoursChange(stored: unknown, requested: unknown): boolean {
  return canonicalOpeningHours(stored) !== canonicalOpeningHours(requested);
}
