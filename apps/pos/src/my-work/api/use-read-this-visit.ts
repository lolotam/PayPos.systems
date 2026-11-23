import { useState } from 'react';

type ReadState = { isSuccess: boolean; isFetchedAfterMount: boolean };

/**
 * هل القراءة دي نجحت من السيرفر في الزيارة الحالية للشاشة؟ بيانات الكاش من زيارة سابقة ما تتعتبرش قراءة،
 * لأن react-query بيدّيها للمراقب الجديد وطلبه لسه معلّق (مراقب متداخل، أو نفس الجلسة تفتح الشاشة قبل ما الكاش يتنضف).
 *
 * `isFetchedAfterMount` بتبقى true بعد الفشل زي النجاح، فلازم تتجمع مع `isSuccess`. والإثبات بيتفتكر للمفتاح الحالي بس،
 * لأن فشل صفحة لاحقة بيحوّل الحالة لخطأ والصفوف المحمّلة فعلاً في الزيارة دي لازم تفضل ظاهرة. لما المفتاح يتغيّر
 * (شهر تاني) القراءة الجديدة هي اللي تثبت نفسها.
 *
 * @param readKey معرّف القراءة (النوع والشهر)؛ تغييره بيلغي الإثبات القديم
 * @param query حالة الاستعلام
 * @returns true لو السيرفر رد بنجاح على قراءة المفتاح ده في الزيارة الحالية
 */
export function useReadThisVisit(readKey: string, query: ReadState): boolean {
  const [provenKey, setProvenKey] = useState<string>();
  const granted = query.isSuccess && query.isFetchedAfterMount;
  if (granted && provenKey !== readKey) setProvenKey(readKey);
  return granted || provenKey === readKey;
}
