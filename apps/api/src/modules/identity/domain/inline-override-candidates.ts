import type { ScopeType } from './access.ts';
import type { OverrideTerms } from './permission-edit.ts';

/**
 * يرتّب العضويات المرشحة لكتابة استثناء صلاحية (080-b): العضوية اللي نطاقها يطابق نطاق
 * الاستثناء أول، بعدين العضوية الأساسية، وبعدها الباقي بالترتيب الأصلي. أول تطابق هو اللي
 * بيتقبل، فالترتيب ده هو اللي بيحدد أين ينزل الاستثناء وما يتنقلش لتغطية فرع ما طلبوش.
 *
 * المطابقة على نوع النطاق ومعرّفه، ومعرّف النطاق بيتقارن من غير حساسية حالة الأحرف عشان
 * UUID المكتوب بحرف كبير والكتير بحرف صغير يبقوا نفس النطاق.
 *
 * @param memberships العضويات المرشحة — الأساسية أولاً
 * @param terms      نطاق الاستثناء المطلوب كتابته
 * @returns ترتيب العضويات المرشحة أول مطابقة فيها
 */
export function orderOverrideCandidateMemberships<
  T extends { readonly scopeType: ScopeType; readonly scopeId: string },
>(memberships: readonly T[], terms: Pick<OverrideTerms, 'scope_type' | 'scope_id'>): T[] {
  const scopeId = terms.scope_id.toLowerCase();
  const matching = memberships.filter(
    (membership) =>
      membership.scopeType === terms.scope_type && membership.scopeId.toLowerCase() === scopeId,
  );
  const primary = memberships[0];
  const rest = memberships.filter(
    (membership) => !matching.includes(membership) && membership !== primary,
  );
  return [
    ...matching,
    ...(primary !== undefined && !matching.includes(primary) ? [primary] : []),
    ...rest,
  ];
}
