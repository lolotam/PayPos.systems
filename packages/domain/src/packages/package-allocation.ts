import { sumMoney, type Money } from '../money.js';

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
  /** قيم جلسات الاستيراد المحسوبة على مستوى الباقة؛ لا يعاد تقسيمها على المكون. */
  readonly sessionValues?: { readonly base: Money; readonly last: Money };
}

/**
 * بيوزع المدفوع بنسبة سعر الخدمة الأصلي × جلساتها، أو بعدد الجلسات لو كل الأسعار صفر.
 * largest remainder والتعادل حسب serviceId بيحافظوا على المدفوع للفلس من غير تقريب مستقل للحصص (§8).
 *
 * @param pricePaid المدفوع الأصلي بالفلوس
 * @param components لقطة الخدمات والجلسات الأصلية
 * @param mode طريقة التقييم؛ الاستيراد يوزع بالتساوي ويترك كل باقي الفلوس لآخر جلسة من آخر مكون
 * @returns مكونات بنفس ترتيب المدخل وبقيم مجموعها يساوي المدفوع بالضبط
 */
export function allocatePackagePrice(
  pricePaid: Money,
  components: readonly PackageAllocationComponent[],
  mode: 'list-price' | 'session-count' = 'list-price',
): ValuedPackageComponent[] {
  validatePackageDefinition(pricePaid, components);
  if (mode === 'session-count') {
    components.forEach((component) => validatePackagePrice(component.listPriceSnapshot));
    const total = components.reduce((count, component) => count + BigInt(component.sessions), 0n);
    const base = pricePaid / total;
    const remainder = pricePaid % total;
    return components.map((component, index) => ({
      ...component,
      componentValue:
        base * BigInt(component.sessions) + (index === components.length - 1 ? remainder : 0n),
      sessionValues: { base, last: base + (index === components.length - 1 ? remainder : 0n) },
    }));
  }
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
