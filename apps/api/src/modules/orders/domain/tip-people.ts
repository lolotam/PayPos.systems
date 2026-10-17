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

/** صف موظفة بعد دمج التكرار؛ التعارض يثبت أن الربط الحالي لا يُحسم. */
export interface IndexedTipPerson {
  has_active_line: boolean;
  identities: readonly TipIdentity[];
  current_user_id: string | null;
  current_user_conflict: boolean;
}

/**
 * يدمج ربطين حاليين: الفارغ لا يمسح الموجود، والمختلف بغير حالة الحروف تعارض.
 * التعارض يُغلق اللمس لأننا لا نعرف أي ربط هو هوية الموظفة.
 *
 * @param previous الصف المدمج حتى الآن
 * @param next الربط الحالي في الصف التالي
 * @returns الربط بعد الدمج وراية التعارض
 */
function mergeCurrentUser(
  previous: IndexedTipPerson,
  next: string | null,
): { current_user_id: string | null; conflict: boolean } {
  if (previous.current_user_conflict) return { current_user_id: null, conflict: true };
  const current = previous.current_user_id;
  if (current === null || next === null || current.toLowerCase() === next.toLowerCase()) {
    return { current_user_id: current ?? next, conflict: false };
  }
  return { current_user_id: null, conflict: true };
}

/**
 * يجمع صفّين لنفس الموظفة: اتحاد اللقطات، وسطر فعّال لو أيهما فعّال.
 *
 * @param previous الصف المدمج
 * @param person الصف التالي
 * @returns الصف بعد الدمج
 */
function combineTipPeople(previous: IndexedTipPerson, person: TipPerson): IndexedTipPerson {
  const current = mergeCurrentUser(previous, person.current_user_id);
  return {
    has_active_line: previous.has_active_line || person.has_active_line,
    identities: [...previous.identities, ...person.identities],
    current_user_id: current.current_user_id,
    current_user_conflict: current.conflict,
  };
}

/**
 * يفهرس منفّذات الزيارة بهوية صغيرة ويدمج تكرار الموظفة حتى لا تسقط لقطة أو ربط.
 * الإبقاء على آخر صف فقط كان يفتح اللمس رغم لقطة ناقصة في صف سابق.
 *
 * @param people منفّذات الزيارة الحاليات واللاتي أُزيلن
 * @returns خريطة الهوية إلى الصف المدمج
 */
export function indexTipPeople(people: readonly TipPerson[]): ReadonlyMap<string, IndexedTipPerson> {
  const indexed = new Map<string, IndexedTipPerson>();
  for (const person of people) {
    const key = person.employee_id.toLowerCase();
    const previous = indexed.get(key);
    indexed.set(
      key,
      previous === undefined
        ? {
            has_active_line: person.has_active_line,
            identities: person.identities,
            current_user_id: person.current_user_id,
            current_user_conflict: false,
          }
        : combineTipPeople(previous, person),
    );
  }
  return indexed;
}

/**
 * هل الفاعل هو هذه الموظفة باللقطة أو بالربط الحالي.
 * القيمة الفارغة لا تطابق أحداً، والمقارنة بعد تصغير الحروف.
 *
 * @param actorKey هوية الفاعل بحروف صغيرة
 * @param person صف الموظفة
 * @returns هل الفاعل هي صاحبة السطر
 */
export function actorMatches(actorKey: string, person: IndexedTipPerson): boolean {
  if (person.current_user_id !== null && person.current_user_id.toLowerCase() === actorKey)
    return true;
  return person.identities.some(
    (row) => row.linked_user_id !== null && row.linked_user_id.toLowerCase() === actorKey,
  );
}
