import type { AlertRecipientRole, EffectiveAlertRule } from '@pospay/domain';

/**
 * بيقرر واجهة الجرس من القاعدة الفعلية: المستلمين بالدور والقناة.
 * القاعدة المقفولة أو اللي ماعندهاش قناة داخل التطبيق ما بتوصّلش حد: أدوار فاضية وقناة null.
 * مكان الدالة واحد لكل أجراس الـ orders، فكل جرس بيمشي على نفس القاعدة بدل قاعدة مؤقتة لكل جرس.
 *
 * @param rule القاعدة الفعلية بعد المفتاح العام
 * @returns أدوار المستلمين وقناة الجرس؛ قناة null معناها مفيش جرس
 */
export function bellDelivery(
  rule: Pick<EffectiveAlertRule, 'enabled' | 'recipientRoles' | 'channels'>,
): { roles: readonly AlertRecipientRole[]; channel: 'IN_APP' | null } {
  if (!rule.enabled || !rule.channels.includes('IN_APP')) return { roles: [], channel: null };
  return { roles: rule.recipientRoles, channel: 'IN_APP' };
}
