import { useState } from 'react';

type ReadState = { isSuccess: boolean; isFetchedAfterMount: boolean };

/**
 * هل القراءة دي نجحت من السيرفر في الزيارة الحالية للشاشة؟ بيانات الكاش من زيارة سابقة ما تتعتبرش قراءة،
 * لأن react-query بيدّيها للمراقب الجديد وطلبه لسه معلّق. (كل زيارة ليها مفاتيحها الخاصة، فالحالة دي دفاع إضافي.)
 *
 * `isFetchedAfterMount` بتبقى true بعد الفشل زي النجاح، فلازم تتجمع مع `isSuccess`. الإثبات بيتصفّر مع كل تغيير في
 * المفتاح (شهر تاني)، فالرجوع لمفتاح قديم لازم يتقرأ من جديد قبل ما بياناته تتعرض.
 *
 * `keepAfterFailure` للقوائم المقسّمة بس: فشل صفحة لاحقة بيحوّل الحالة لخطأ والصفوف اللي اتحمّلت فعلاً في الزيارة دي
 * تحت المفتاح الحالي لازم تفضل ظاهرة. القراءات اللي رد واحد (إكراميات، تقييم) ما بتفضلش: أي خطأ حالي (401/403 مثلاً)
 * بيخفي بياناتها القديمة.
 *
 * @param readKey معرّف القراءة (النوع والشهر)؛ تغييره بيلغي الإثبات القديم
 * @param query حالة الاستعلام
 * @param keepAfterFailure true للقائمة المقسّمة: الإثبات بيفضل بعد فشل صفحة إضافية
 * @returns true لو السيرفر رد بنجاح على قراءة المفتاح ده في الزيارة الحالية
 */
export function useReadThisVisit(
  readKey: string,
  query: ReadState,
  keepAfterFailure = false,
): boolean {
  const granted = query.isSuccess && query.isFetchedAfterMount;
  const [proof, setProof] = useState({ key: readKey, kept: false });
  const kept = keepAfterFailure && granted;
  if (proof.key !== readKey || (kept && !proof.kept)) setProof({ key: readKey, kept });
  return granted || (keepAfterFailure && proof.key === readKey && proof.kept);
}
