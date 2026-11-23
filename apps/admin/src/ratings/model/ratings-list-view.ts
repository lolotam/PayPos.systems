import { readAccessProof } from '@/shared/api/read-access-proof';

type ListState = Parameters<typeof readAccessProof>[0] & { data: unknown };

/**
 * ما تعرضه قائمة التقييمات: التعليقات ما بتتعرض إلا بعد قراءة ناجحة في الزيارة الحالية (مش من الكاش)،
 * والرفض (401/403) بيخفيها فورًا. فشل غير الرفض بيسيب ظاهرة مع خطأ وإعادة محاولة بس الصفحات اللي اتقرت بنجاح في الزيارة دي؛
 * لو الزيارة ما قرتش حاجة بنجاح (فشلت أول قراءة) فالكاش القديم ما بيظهرش.
 *
 * @param list حالة استعلام القائمة
 * @param readThisVisit البيانات اللي اتقرت بنجاح في الزيارة الحالية (`useDataReadThisVisit`)
 * @returns حالة العرض
 */
export function ratingsListView(
  list: ListState,
  readThisVisit: unknown,
): 'loading' | 'refused' | 'failed' | 'ready' | 'ready-with-error' {
  const proof = readAccessProof(list);
  if (proof === 'pending') return 'loading';
  if (proof === 'refused') return 'refused';
  if (proof === 'failed')
    return list.data !== undefined && list.data === readThisVisit ? 'ready-with-error' : 'failed';
  return 'ready';
}
