import type { OverrideTerms, PermissionEditContext } from './permission-edit.ts';
import { RATINGS_READ_PERMISSION } from './ratings-read-eligibility.ts';

/**
 * ❌ لا يقبل ALLOW حتى لو المدير يملك الإذن؛ الأدوار المخصصة تحتفظ بسياسة PR 7.
 * لإذن قراءة التقييمات (`read:ratings:branch`)، الرفض العام بنقص الخانة (`PERMISSION_ROLE_FORBIDDEN`) يخص دور
 * الجهاز فقط، بينما الأدوار البشرية يُفحص أولًا نطاقها مقابل نطاق العضوية (`PERMISSION_SCOPE_OUTSIDE_REACH`)
 * ثم تقرر القاعدة المسماة (`PERMISSION_ROLE_NOT_ELIGIBLE`). وقراءة التقييمات لا تتجاوز نطاق العضوية نفسها.
 *
 * @param terms قرار السماح الجديد
 * @param context هوية الدور وأهلية المرجع ونطاق العضوية المؤكد بعد القفل
 * @returns رفض الخانة أو النطاق، أو null للخانة الافتراضية أو الاختيارية أو الدور المخصص أو قراءة التقييمات لدور بشري
 */
export function personalAllowFailure(terms: OverrideTerms, context: PermissionEditContext) {
  const member = context.membership;
  if (member === null || terms.effect !== 'ALLOW') return null;
  // الخانة الناقصة ترفض المنح عموماً، بس كود قراءة التقييمات ليه قاعدة مسماة بتقرر بنفسها (FR-B15)،
  // فالدور غير المدير بيترفض بالقاعدة المسماة مش بالكود العام؛ والجهاز يفضل مرفوضاً بالكود العام
  // لأنه ما بيقراش تقييمات النشاط أصلاً.
  const ratingsRuleDecides =
    terms.permission_code === RATINGS_READ_PERMISSION && member.systemRoleCode !== 'device';
  if (
    !ratingsRuleDecides &&
    member.allowedPermissions !== null &&
    !member.allowedPermissions.includes(terms.permission_code)
  )
    return 'PERMISSION_ROLE_FORBIDDEN' as const;
  if (
    member.systemRoleCode === 'business_manager' &&
    [
      'read:memberships:business',
      'manage:memberships:business',
      'create:customers:business',
      'manage:discount-limits:business',
      'read:passkeys:branch',
      'unbind:passkeys:branch',
    ].includes(terms.permission_code) &&
    (member.scopeType !== 'BUSINESS' ||
      context.membershipTarget?.businessId === undefined ||
      context.target?.businessId !== context.membershipTarget.businessId)
  )
    return 'PERMISSION_SCOPE_OUTSIDE_REACH' as const;
  if (
    ['branch_manager', 'cashier'].includes(member.systemRoleCode ?? '') &&
    (terms.permission_code === 'create:customers:branch' ||
      (member.systemRoleCode === 'branch_manager' &&
        ['read:passkeys:branch', 'unbind:passkeys:branch'].includes(terms.permission_code))) &&
    (member.scopeType !== 'BRANCH' ||
      terms.scope_type !== 'BRANCH' ||
      terms.scope_id !== member.scopeId)
  )
    return 'PERMISSION_SCOPE_OUTSIDE_REACH' as const;
  // المنح بنطاق أوسع من عضوية صاحبه هيفتح له فروع خارج نطاقه، لأن القارئ بياخد نطاق الاستثناء المحفوظ كما هو.
  if (
    terms.permission_code === RATINGS_READ_PERMISSION &&
    member.scopeType !== 'COMPANY' &&
    (terms.scope_type !== member.scopeType || terms.scope_id !== member.scopeId)
  )
    return 'PERMISSION_SCOPE_OUTSIDE_REACH' as const;
  return null;
}
