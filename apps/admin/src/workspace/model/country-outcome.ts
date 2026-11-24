'use client';

import type { Country } from '@pospay/contracts';

/**
 * نتيجة حفظ دولة النشاط تعيش بره الشاشة (في الذاكرة بس، لا localStorage): شاشة أول نشاط بتفك
 * تركيبها أول ما القراءة المحدّثة توصل، والتنبيه لازم يعيش معاها على شاشة أول فرع لحد ما
 * المستخدم ينجحه بـ «حاول تاني» أو يتجاهله أو يسيب سيل الإعداد كله.
 */
const unsavedCountries = new Map<string, Country>();

/** بيرجع الدولة اللي ما اتحفظتش للنشاط ده، أو لا لو مفيش. */
export function readUnsavedCountry(businessId: string): Country | undefined {
  return unsavedCountries.get(businessId);
}

export function writeUnsavedCountry(businessId: string, country: Country): void {
  unsavedCountries.set(businessId, country);
}

export function clearUnsavedCountry(businessId: string): void {
  unsavedCountries.delete(businessId);
}
