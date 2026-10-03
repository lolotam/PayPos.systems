import { sumMoney, type Money } from '@pospay/domain';

import {
  validatePackageDefinition,
  validatePackagePrice,
  type PackageComponentDefinition,
} from './package-definition.js';

/** لقطة سعر الخدمة وقت البيع؛ تغيير الكتالوج لاحقاً ما يغيّرش قيمة الجلسات. */
export interface PackageAllocationComponent extends PackageComponentDefinition {
  readonly listPriceSnapshot: Money;
}

/** قيمة المكون المحفوظة قبل توزيعها على الجلسات الأصلية. */
export interface ValuedPackageComponent extends PackageAllocationComponent {
  readonly componentValue: Money;
}

/**
 * بيوزع المدفوع بنسبة سعر الخدمة الأصلي × جلساتها، أو بعدد الجلسات لو كل الأسعار صفر.
 * largest remainder والتعادل حسب serviceId بيحافظوا على المدفوع للفلس من غير تقريب مستقل للحصص (§8).
 *
 * @param pricePaid المدفوع الأصلي بالفلوس
 * @param components لقطة الخدمات والجلسات الأصلية
 * @returns مكونات بنفس ترتيب المدخل وبقيم مجموعها يساوي المدفوع بالضبط
 */
export function allocatePackagePrice(
  pricePaid: Money,
  components: readonly PackageAllocationComponent[],
): ValuedPackageComponent[] {
  validatePackageDefinition(pricePaid, components);
  const weights = components.map(
    (component) => validatePackagePrice(component.listPriceSnapshot) * BigInt(component.sessions),
  );
  const listTotal = weights.reduce((total, weight) => total + weight, 0n);
  const effectiveWeights =
    listTotal === 0n ? components.map((component) => BigInt(component.sessions)) : weights;
  const totalWeight = effectiveWeights.reduce((total, weight) => total + weight, 0n);
  const shares = components.map((component, index) => {
    const numerator = pricePaid * (effectiveWeights[index] ?? 0n);
    return { component, index, value: numerator / totalWeight, remainder: numerator % totalWeight };
  });
  let leftover = pricePaid - sumMoney(shares.map((share) => share.value));
  const ranked = [...shares].sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    return a.component.serviceId < b.component.serviceId ? -1 : 1;
  });
  for (const share of ranked) {
    if (leftover === 0n) break;
    share.value += 1n;
    leftover -= 1n;
  }
  return shares.map(({ component, value }) => ({ ...component, componentValue: value }));
}
