/** النتيجة الصريحة تمنع اعتبار غياب الإعداد سماحًا تلقائيًا بالخصم. */
export type EffectiveDiscountLimit =
  | { readonly status: 'UNLIMITED'; readonly source: 'OWNER' }
  | { readonly status: 'SET'; readonly source: 'PERSON' | 'BUSINESS'; readonly limit_bps: number }
  | { readonly status: 'NOT_CONFIGURED' }
  | { readonly status: 'MEMBERSHIP_NOT_FOUND' };

/** الحد الشخصي وحالة صاحب العضوية بعد التحقق من النشاط والسريان في identity. */
export type DiscountSubject =
  | { readonly status: 'MEMBERSHIP_NOT_FOUND' }
  | { readonly status: 'FOUND'; readonly limit_bps: number | null; readonly owner: boolean };

/**
 * بيحل حد الخصم: المالك النشط بلا حد، ثم الشخص، ثم النشاط، ثم عدم إعداد صريح.
 * غياب العضوية لا يتحول إلى صلاحية باستخدام افتراضي النشاط.
 *
 * @param subject العضوية المتاحة في النشاط وحالة صاحبها
 * @param businessDefault افتراضي النشاط أو null عند عدم الإعداد
 * @returns حد مع مصدره أو حالة مستقلة بدون افتراض قاعدة ناقصة
 */
export function resolveEffectiveDiscountLimit(
  subject: DiscountSubject,
  businessDefault: number | null,
): EffectiveDiscountLimit {
  if (subject.status === 'MEMBERSHIP_NOT_FOUND') return subject;
  if (subject.owner) return { status: 'UNLIMITED', source: 'OWNER' };
  const limit = subject.limit_bps ?? businessDefault;
  // TODO(spec): معنى عدم إعداد الحدين يحتاج قرار المالك؛ التوصية 0% وكل خصم موجب يحتاج موافقة في PR 35.
  if (limit === null) return { status: 'NOT_CONFIGURED' };
  if (!Number.isInteger(limit) || limit < 0 || limit > 10000)
    throw new RangeError('Invalid discount bps');
  return {
    status: 'SET',
    source: subject.limit_bps === null ? 'BUSINESS' : 'PERSON',
    limit_bps: limit,
  };
}
