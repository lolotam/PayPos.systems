import type { Locale } from '@pospay/i18n';
import type { MessageKey } from '@pospay/i18n';
import { formatKwd } from '@pospay/i18n';
import { parseMoney } from '@pospay/domain';
import { id } from '@pospay/contracts';
import type {
  CustomerPackageDetailComponent,
  CustomerPackageDetailSlot,
  CustomerPackageListItem,
} from '@pospay/contracts';

const idSchema = id;

/**
 * بيتحقق إن مقطع العنوان UUID صالح ويرجّعه بحروف صغيرة، أو null لو مش صالح
 * عشان الشاشة تعرض «غير موجود» من غير ما تطلب تفصيل بعنوان فاسخ.
 *
 * @param raw المقطع أو قيمة الاستعلام الخام
 * @returns المعرف الصالح بحروف صغيرة، أو null
 */
export function parsePackageRouteId(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const parsed = idSchema.safeParse(raw);
  return parsed.success ? parsed.data.toLowerCase() : null;
}

/** اسم الباقة بلغة المستخدم: العربي بيرجع للإنجليزي لما مايتوفرش. */
export function packageName(
  locale: Locale,
  names: Pick<CustomerPackageListItem, 'name_en' | 'name_ar'>,
): string {
  return locale === 'ar' ? (names.name_ar ?? names.name_en) : names.name_en;
}

/** اسم الخدمة المكوّنة بلغة المستخدم بنفس قاعدة الباقة. */
export function componentName(
  locale: Locale,
  component: Pick<CustomerPackageDetailComponent, 'name_en' | 'name_ar'>,
): string {
  return packageName(locale, component);
}

/** الأصل: مباعة هنا أو مستوردة — ومفيش قيمة تالتة في العقد. */
export function provenanceKey(provenance: CustomerPackageListItem['provenance']): MessageKey {
  return provenance === 'IMPORTED' ? 'customerPackages.imported' : 'customerPackages.sold';
}

/** حالة الخانة الواحدة في التفصيل على أربعة حالات العقد. */
export function slotLabelKey(state: CustomerPackageDetailSlot['state']): MessageKey {
  switch (state) {
    case 'USED':
      return 'customerPackages.slotUsed';
    case 'REFUNDED':
      return 'customerPackages.slotRefunded';
    case 'IMPORTED_USED':
      return 'customerPackages.slotImportedUsed';
    default:
      return 'customerPackages.slotFree';
  }
}

/** طريقة الدفع على تسميات بيع الباقة الموجودة؛ null يعني مستوردة وليس لها طريقة دفع. */
export function paidMethodKey(method: 'CASH' | 'CARD' | null): MessageKey | null {
  if (method === null) return null;
  return method === 'CARD' ? 'packageSale.card' : 'packageSale.cash';
}

/** تنسيق مبلغ الباقات للعرض بس: النصوص بتأتي من القراءة كنصوص ثلاثية الكسور، ومفيش أي حساب جديد. */
export function packageMoney(value: string): string {
  return formatKwd(parseMoney(value));
}
