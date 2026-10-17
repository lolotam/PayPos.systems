import { MONEY_MAX, sumMoney } from '@pospay/domain';
import { SessionError } from './session-error.ts';

/** سطر بقشيش لموظفة واحدة بطريقة دفع واحدة. */
export interface TipEntry {
  employee_id: string;
  method: 'CASH' | 'CARD';
  amount: bigint;
}

/** لقطة هوية منفّذة؛ الربط الفارغ لا يطابق أحداً. */
export interface TipIdentity {
  linked_user_id: string | null;
  linked_user_snapshotted: boolean;
}

/**
 * موظفة نفّذت على الزيارة أو أُزيلت لاحقاً وهويتها ما زالت محفوظة.
 * الصف الذي لم تُلتقط هويته يُغلق التعديل عليها لكل الفاعلين.
 */
export interface TipPerson {
  employee_id: string;
  has_active_line: boolean;
  identities: readonly TipIdentity[];
  current_user_id: string | null;
}

/** المجموعة الحالية والمجموعة المطلوبة والفاعل ومنفّذات الزيارة. */
export interface TipSetInput {
  actor_user_id: string;
  current: readonly TipEntry[];
  requested: readonly TipEntry[];
  people: readonly TipPerson[];
}

/** فرق المجموعة المطلوبة عن المراجعة الحالية، جاهز للتدقيق من غير حساب إضافي. */
export interface TipSetResult {
  added: TipEntry[];
  changed: TipEntry[];
  removed: TipEntry[];
  carried: TipEntry[];
  total_cash: bigint;
  total_card: bigint;
  changed_anything: boolean;
}

interface TipGroups {
  added: TipEntry[];
  changed: TipEntry[];
  removed: TipEntry[];
  carried: TipEntry[];
}

/**
 * يرتّب هويات الموظفات تصاعدياً بعد توحيد حالة الأحرف.
 *
 * @param left هوية الموظفة الأولى
 * @param right هوية الموظفة الثانية
 * @returns سالب لو الأولى أصغر، وصفر عند التساوي، وموجب لو الثانية أصغر
 */
function compareEmployeeId(left: string, right: string): number {
  const lowerLeft = left.toLowerCase();
  const lowerRight = right.toLowerCase();
  return lowerLeft < lowerRight ? -1 : lowerLeft > lowerRight ? 1 : 0;
}

/**
 * مفتاح السطر هو الموظفة وطريقة الدفع، والهوية تُقارَن بلا التفات لحالة الحروف.
 *
 * @param entry سطر بقشيش
 * @returns مفتاح فريد داخل المراجعة الواحدة
 */
function entryKey(entry: TipEntry): string {
  return `${entry.employee_id.toLowerCase()}\0${entry.method}`;
}

/**
 * يرتّب سطور البقشيش بالهوية ثم بطريقة الدفع حتى يثبت خرج التصنيف.
 *
 * @param left السطر الأول
 * @param right السطر الثاني
 * @returns ترتيب المقارنة
 */
function compareTipEntries(left: TipEntry, right: TipEntry): number {
  const byEmployee = compareEmployeeId(left.employee_id, right.employee_id);
  if (byEmployee !== 0) return byEmployee;
  return left.method < right.method ? -1 : left.method > right.method ? 1 : 0;
}

/**
 * ينسخ السطور مرتبة من غير تعديل المصفوفة التي أرسلها المستدعي.
 *
 * @param entries سطور بغير ترتيب ثابت
 * @returns نسخة مرتبة بالهوية ثم الطريقة
 */
function sortEntries(entries: readonly TipEntry[]): TipEntry[] {
  return [...entries].sort(compareTipEntries);
}

/**
 * يرفض المبلغ غير الموجب أو الأكبر من حد العمود، والسطر المكرر لنفس الموظفة ونفس الطريقة.
 *
 * @param requested المجموعة التي أرسلتها الكاشيرة
 * @returns لا شيء؛ الشكل الخطأ يرفض قبل أي قاعدة هوية
 */
function assertTipShape(requested: readonly TipEntry[]): void {
  const seen = new Set<string>();
  for (const entry of requested) {
    if (typeof entry.amount !== 'bigint' || entry.amount <= 0n || entry.amount > MONEY_MAX) {
      throw new SessionError('VALIDATION_FAILED');
    }
    if (entry.method !== 'CASH' && entry.method !== 'CARD')
      throw new SessionError('VALIDATION_FAILED');
    const key = entryKey(entry);
    if (seen.has(key)) throw new SessionError('VALIDATION_FAILED');
    seen.add(key);
  }
}

/**
 * يصنّف كل زوج (موظفة، طريقة) إلى منقول أو مضاف أو متغيّر أو محذوف.
 * المنقول كما هو لا يُعاد فحصه لاحقاً، لأن إلغاء السطر لا يمسح بقشيشاً دُفع.
 *
 * @param current سطور المراجعة الحالية
 * @param requested المجموعة الكاملة المطلوبة
 * @returns المجموعات الأربع مرتبة
 */
function classifyTipEntries(
  current: readonly TipEntry[],
  requested: readonly TipEntry[],
): TipGroups {
  const currentByKey = new Map(current.map((entry) => [entryKey(entry), entry]));
  const added: TipEntry[] = [];
  const changed: TipEntry[] = [];
  const carried: TipEntry[] = [];
  const seen = new Set<string>();
  for (const entry of requested) {
    const key = entryKey(entry);
    seen.add(key);
    const previous = currentByKey.get(key);
    if (previous === undefined) added.push(entry);
    else if (previous.amount === entry.amount) carried.push(entry);
    else changed.push(entry);
  }
  const removed = [...currentByKey.values()].filter((entry) => !seen.has(entryKey(entry)));
  return {
    added: sortEntries(added),
    changed: sortEntries(changed),
    removed: sortEntries(removed),
    carried: sortEntries(carried),
  };
}

/**
 * يفهرس منفّذات الزيارة بهوية صغيرة حتى تتطابق الحروف المختلفة.
 *
 * @param people منفّذات الزيارة الحاليات واللاتي أُزيلن
 * @returns خريطة الهوية إلى صف الموظفة
 */
function indexTipPeople(people: readonly TipPerson[]): ReadonlyMap<string, TipPerson> {
  return new Map(people.map((person) => [person.employee_id.toLowerCase(), person]));
}

/**
 * هل الفاعل هو هذه الموظفة باللقطة أو بالربط الحالي.
 * القيمة الفارغة لا تطابق أحداً، والمقارنة بعد تصغير الحروف.
 *
 * @param actorKey هوية الفاعل بحروف صغيرة
 * @param person صف الموظفة
 * @returns هل الفاعل هي صاحبة السطر
 */
function actorMatches(actorKey: string, person: TipPerson): boolean {
  if (person.current_user_id !== null && person.current_user_id.toLowerCase() === actorKey)
    return true;
  return person.identities.some(
    (row) => row.linked_user_id !== null && row.linked_user_id.toLowerCase() === actorKey,
  );
}

/**
 * يرفض لمس سطر لا تُثبَت هوية صاحبته، أو سطر الفاعل نفسها.
 * الحذف لموظفة غائبة عن القائمة يُغلق لأننا لا نستطيع نفي أنها الفاعل.
 *
 * @param actorUserId مستخدمة الطلب
 * @param groups التصنيف بعد فحص الشكل
 * @param people منفّذات الزيارة
 * @returns لا شيء؛ أول رفض هوية يوقف الطلب
 */
function assertTipIdentity(
  actorUserId: string,
  groups: TipGroups,
  people: ReadonlyMap<string, TipPerson>,
): void {
  const actorKey = actorUserId.toLowerCase();
  const removedKeys = new Set(groups.removed.map((entry) => entryKey(entry)));
  const touched = sortEntries([...groups.added, ...groups.changed, ...groups.removed]);
  for (const entry of touched) {
    const person = people.get(entry.employee_id.toLowerCase());
    if (person === undefined) {
      if (removedKeys.has(entryKey(entry))) throw new SessionError('TIP_IDENTITY_UNKNOWN');
      continue;
    }
    if (person.identities.some((row) => row.linked_user_snapshotted === false)) {
      throw new SessionError('TIP_IDENTITY_UNKNOWN');
    }
    if (actorMatches(actorKey, person)) throw new SessionError('TIP_SELF_FORBIDDEN');
  }
}

/**
 * الإضافة والتغيير فقط يحتاجان سطراً فعّالاً؛ الحذف والمنقول لا يُعاد فحصهما.
 *
 * @param groups التصنيف بعد فحص الهوية
 * @param people منفّذات الزيارة
 * @returns لا شيء؛ موظفة بلا سطر فعّال أو غائبة عن الزيارة ترفض
 */
function assertActivePerformers(groups: TipGroups, people: ReadonlyMap<string, TipPerson>): void {
  for (const entry of sortEntries([...groups.added, ...groups.changed])) {
    const person = people.get(entry.employee_id.toLowerCase());
    if (person === undefined || person.has_active_line === false) {
      throw new SessionError('TIP_EMPLOYEE_NOT_PERFORMER');
    }
  }
}

/**
 * يجمع نقد المجموعة المطلوبة وبطاقتها ويرفض المجموع الخارج عن حد العمود.
 * الفحص على كل طريقة وحدها، لأن العمودين مستقلان مثل إجمالي الزيارة.
 *
 * @param requested المجموعة بعد نجاح القواعد السابقة
 * @returns إجمالي النقد وإجمالي البطاقة بالفلس
 */
function tipTotals(requested: readonly TipEntry[]): { total_cash: bigint; total_card: bigint } {
  const amounts = (method: TipEntry['method']) =>
    requested.filter((entry) => entry.method === method).map((entry) => entry.amount);
  try {
    return { total_cash: sumMoney(amounts('CASH')), total_card: sumMoney(amounts('CARD')) };
  } catch {
    throw new SessionError('TIP_TOTAL_TOO_LARGE');
  }
}

/**
 * يفحص مجموعة البقشيش المطلوبة ويرجع فرقها عن المراجعة الحالية.
 * ترتيب الرفض ثابت: شكل المبلغ والتكرار، ثم الهوية (لقطة ناقصة ثم النفس، وحذف الغائبة يُغلق)، ثم أن الإضافة أو التغيير لمنفّذة فعّالة، ثم سقف إجمالي النقد وسقف إجمالي البطاقة.
 * السطور المنقولة كما هي لا تُفحص، حتى يبقى بقشيش دُفع قابلاً للبقاء بعد إلغاء السطر أو نقله.
 *
 * @param input الفاعل والمجموعة الحالية والمجموعة المطلوبة وهويات منفّذات الزيارة
 * @returns الإضافات والتغييرات والحذف والمنقول وإجمالي كل طريقة وراية وجود فرق
 */
export function validateTipSet(input: TipSetInput): TipSetResult {
  assertTipShape(input.requested);
  const groups = classifyTipEntries(input.current, input.requested);
  const people = indexTipPeople(input.people);
  assertTipIdentity(input.actor_user_id, groups, people);
  assertActivePerformers(groups, people);
  const totals = tipTotals(input.requested);
  const changed_anything = groups.added.length + groups.changed.length + groups.removed.length > 0;
  return { ...groups, ...totals, changed_anything };
}
