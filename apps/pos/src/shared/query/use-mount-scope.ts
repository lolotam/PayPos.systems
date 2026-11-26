import { useMemo, useState } from 'react';

/** بادئة كل مفاتيح القراءات الشخصية في زيارة واحدة للشاشة: القسم ثم هوية الموظفة ثم رقم الزيارة. */
export type MountScope = readonly [string, string, number];

let mounts = 0;

/**
 * مساحة مفاتيح خاصة بكل تركيب للشاشة الشخصية، فزيارتان (أو مراقبان متداخلان) على نفس الـ client ما بيتشاركوش
 * في إدخال كاش ولا في طلب شغال: لو اتشاركوا، رد طلب واحد كان بيثبّت للمراقب التاني بيانات ما قراهاش هو.
 *
 * @param prefix اسم الشاشة (بيبقى أول عنصر في مفتاح الكاش)
 * @param identity هوية الموظفة (بتتغيّر مع الجلسة)
 * @returns بادئة المفاتيح، ثابتة طول عمر التركيب
 */
export function useMountScope(prefix: string, identity: string): MountScope {
  const [id] = useState(() => ++mounts);
  return useMemo(() => [prefix, identity, id] as const, [prefix, identity, id]);
}
