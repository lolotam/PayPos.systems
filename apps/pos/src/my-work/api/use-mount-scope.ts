import { useMemo, useState } from 'react';

/** بادئة كل مفاتيح القراءات الشخصية في زيارة واحدة للشاشة: هوية الموظفة ثم رقم الزيارة. */
export type MountScope = readonly ['my-work', string, number];

let mounts = 0;

/**
 * مساحة مفاتيح خاصة بكل تركيب للشاشة الشخصية، فزيارتان (أو مراقبان متداخلان) على نفس الـ client ما بيتشاركوش
 * في إدخال كاش ولا في طلب شغال: لو اتشاركوا، رد طلب واحد (صفحة تانية مثلاً) كان بيثبّت للمراقب التاني صفحات ما قراهاش هو.
 *
 * @param identity هوية الموظفة (بتتغيّر مع الجلسة)
 * @returns بادئة المفاتيح، ثابتة طول عمر التركيب
 */
export function useMountScope(identity: string): MountScope {
  const [id] = useState(() => ++mounts);
  return useMemo(() => ['my-work', identity, id] as const, [identity, id]);
}
