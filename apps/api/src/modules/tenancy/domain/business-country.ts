import { GCC_IBAN_COUNTRIES } from '@pospay/domain';

/** دولة النشاط المقبولة كما تُقرأ من الإعدادات المخزّنة، أو «غير محددة». */
export type BusinessCountryPrior = { readonly country: string | null };

/**
 * بيقرأ دولة النشاط من الإعدادات المخزّنة كما هي في قاعدة البيانات: القيمة المقبولة فقط تعدّ محددة،
 * وغياب المفتاح أو أي قيمة مخزّنة قبل هذا التسليم أو غير صالحة تعني «غير محددة» — مفيش تخمين ولا
 * استنتاج من العملة أو التوقيت، عشان قرار عدم الافتراضي (34-pre-3 B-4) يفضل مطبّق على الصفوف القديمة.
 * القائمة نفسها هي قائمة GCC_IBAN_COUNTRIES في packages/domain، فمفيش قائمة تانية بتتذكّر منفصلة.
 *
 * @param settings الإعدادات المخزّنة كما وصلت من الصف المقفول، أو `null` لو مفيش إعدادات
 * @returns رمز الدولة المقبول أو `null` لو غير محددة
 */
export function storedBusinessCountry(
  settings: Readonly<Record<string, unknown>> | null,
): string | null {
  const value = settings?.['country'];
  return typeof value === 'string' && (GCC_IBAN_COUNTRIES as readonly string[]).includes(value)
    ? value
    : null;
}

/**
 * بيقرر تغيير دولة النشاط قبل أي كتابة: التغيير يحصل فقط لو القيمة المقبولة المخزّنة مختلفة عن المطلوب،
 * والقيمة القديمة غير الصالحة تتعامل ك«غير محددة» في القرار وفي التدقيق معاً (B-6)، فالقيمة المشوّهة
 * المخزّنة ما بتمنعش الكتابة وما بتظهرش في سجل التدقيق كأنها كانت دولة سارية.
 *
 * @param settings الإعدادات المخزّنة كما وصلت من الصف المقفول، أو `null`
 * @param requested رمز الدولة الجديد المتحقق من العقد
 * @returns هل فيه تغيير فعلي، وقيمة ما قبل التغيير كما تُكتب في التدقيق (`null` = غير محددة)
 */
export function planBusinessCountryChange(
  settings: Readonly<Record<string, unknown>> | null,
  requested: string,
): { readonly changed: boolean; readonly before: string | null } {
  const before = storedBusinessCountry(settings);
  return { changed: before !== requested, before };
}
