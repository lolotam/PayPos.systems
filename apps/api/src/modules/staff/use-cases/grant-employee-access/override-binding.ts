import type { StaffAccessOverrideTerms } from '../../ports/staff-access.port.ts';

/**
 * بصمة canonically لاستثناءات الصلاحيات: نفس الاستثناءات بنفس الترتيب أو بترتيب تاني بتطلع
 * نفس البصمة، ومعرّف النطاق بيتطبّع لحروف صغيرة لأن UUID مش حساس لحالة الأحرف.
 *
 * @param overrides الاستثناءات كما وصلت في الطلب
 * @returns بصمة نصية قابلة للمقارنة
 */
export function canonicalOverrideKey(
  overrides: readonly StaffAccessOverrideTerms[] | undefined,
): string {
  return (overrides ?? [])
    .map((terms) =>
      [
        terms.permission_code,
        terms.effect,
        terms.scope_type,
        terms.scope_id.toLowerCase(),
        terms.expires_at ?? '',
      ].join('\u0000'),
    )
    .sort()
    .join('\u0001');
}
