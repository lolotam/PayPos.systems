import { z } from 'zod';

// Cursor pagination (CLAUDE.md §6). الـ limit بييجي من الـ query string كنص، فبيتعمله coerce.
export const pageQuery = z
  .object({
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .meta({ id: 'PageQuery' });

// الـ limit اختياري في الطلب وليه default بعد الـ parse، فالنوعين مختلفين.
export type PageQueryRequest = z.input<typeof pageQuery>;
export type PageQuery = z.output<typeof pageQuery>;

/**
 * بيلف schema العنصر في envelope الصفحة: العناصر والـ cursor بتاع الصفحة الجاية (null لو دي الأخيرة).
 *
 * @param item schema العنصر الواحد
 * @returns schema الصفحة
 */
export function page<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    next_cursor: z.string().nullable(),
  });
}
