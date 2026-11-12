import type { CustomerPackageListItem } from '@pospay/contracts';
import type { SessionDraftLine } from './session-drafts';

/** خيار باقة مناسب لخدمة السطر، مع الرصيد المتبقي بعد حجز مسودات الزيارة الأخرى. */
export type PackageOption = {
  id: string;
  name_en: string;
  name_ar: string | null;
  expires_on: string;
  expired: boolean;
  remaining: number;
};

/** حالة القائمة المشتركة بين السطور حتى لا يبدأ كل سطر قراءة أو ترقّيًا مستقلًا. */
export type PackageList = {
  items: CustomerPackageListItem[];
  complete: boolean;
  error: boolean;
  loading: boolean;
  retry: () => void;
};

/**
 * يرشّح الباقات التي تغطي الخدمة ويخصم اختيارات المسودات الأخرى من رصيدها.
 * الخيار المستنزف داخل المسودة يبقى ظاهرًا ليتم تعطيله بدل اختفاء اختيار المستخدم.
 *
 * @param items الباقات المحمّلة للزبونة
 * @param serviceId الخدمة المطلوبة في السطر الحالي
 * @param otherPicks اختيارات الباقات في السطور الأخرى
 * @param includeExpired يسمح بالمنتهي عندما يكون تاريخ الزيارة صريحًا والخادم هو الحكم
 * @returns خيارات الخدمة بترتيب القائمة الأصلي
 */
export function packageOptionsForService(
  items: CustomerPackageListItem[],
  serviceId: string,
  otherPicks: { entitlement_id: string; service_id: string }[],
  includeExpired: boolean,
): PackageOption[] {
  return items.flatMap((item) => {
    if (item.used_up || (!includeExpired && item.expired)) return [];
    const component = item.components.find((row) => row.service_id === serviceId && row.remaining > 0);
    if (!component) return [];
    const picked = otherPicks.filter((row) => row.entitlement_id === item.id && row.service_id === serviceId).length;
    return [{
      id: item.id,
      name_en: item.name_en,
      name_ar: item.name_ar,
      expires_on: item.expires_on,
      expired: item.expired,
      remaining: Math.max(0, component.remaining - picked),
    }];
  });
}

/**
 * يقترح أقرب باقة صالحة للانتهاء، ويكسر التعادل بمعرّفها حتى يبقى الاقتراح ثابتًا.
 *
 * @param options خيارات الخدمة بعد خصم اختيارات المسودات الأخرى
 * @returns معرّف الباقة المقترحة، أو null عندما لا يوجد خيار صالح برصيد
 */
export function suggestPackage(options: PackageOption[]): string | null {
  let suggested: PackageOption | null = null;
  for (const option of options) {
    if (option.expired || option.remaining <= 0) continue;
    if (suggested === null || option.expires_on < suggested.expires_on
      || (option.expires_on === suggested.expires_on && option.id < suggested.id)) suggested = option;
  }
  return suggested?.id ?? null;
}

/**
 * يلغي وضع الباقة من كل السطور عند تغيّر الزبونة حتى لا يُنسب رصيد زبونة لأخرى.
 *
 * @param lines مسودات الزيارة الحالية
 * @returns نسخ من السطور بلا وضع باقة أو اختيار استحقاق
 */
export function clearPackagePicks(lines: SessionDraftLine[]): SessionDraftLine[] {
  return lines.map((line) => ({ ...line, from_package: false, package_entitlement_id: null }));
}
