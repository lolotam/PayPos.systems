import { readAccessProof } from '@/shared/api/read-access-proof';

type ListState = Parameters<typeof readAccessProof>[0] & { data: unknown };

/**
 * ما تعرضه قائمة التقييمات: التعليقات ما بتتعرض إلا بعد قراءة ناجحة في الزيارة الحالية (مش من الكاش)،
 * والرفض (401/403) بيخفيها فورًا. فشل غير الرفض بعد ما اتحمّلت صفحات في الزيارة دي بيسيبها ظاهرة مع خطأ وإعادة محاولة.
 *
 * @param list حالة استعلام القائمة
 * @returns حالة العرض
 */
export function ratingsListView(
  list: ListState,
): 'loading' | 'refused' | 'failed' | 'ready' | 'ready-with-error' {
  const proof = readAccessProof(list);
  if (proof === 'pending') return 'loading';
  if (proof === 'refused') return 'refused';
  if (proof === 'failed')
    return list.data !== undefined && list.isFetchedAfterMount ? 'ready-with-error' : 'failed';
  return 'ready';
}
