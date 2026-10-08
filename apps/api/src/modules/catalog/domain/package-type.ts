import { MONEY_MAX, moneyToString, parseMoney } from '@pospay/domain';

import { PackageTypeError } from './errors.ts';

/** تعريف الخدمة داخل الباقة؛ ترتيب المصفوفة هو ترتيب العرض المتفق عليه. */
export interface PackageTypeComponent {
  readonly service_id: string;
  readonly sessions: number;
}
/** شروط النوع ملك catalog؛ لا تحمل أسعار البيع أو عمولات الخطط. */
export interface PackageTypeTerms {
  readonly name_en: string;
  readonly name_ar: string | null;
  readonly price: bigint;
  readonly validity_days: number;
  readonly components: readonly PackageTypeComponent[];
}
/** بيانات الخدمة الحالية للعرض فقط؛ سعرها لا يقيّد سعر الباقة. */
export interface PackageService {
  readonly service_id: string;
  readonly name_en: string;
  readonly name_ar: string | null;
  readonly price: string;
}
/** سجل النوع بنسخة تفاؤلية؛ لا يغيّر أي استحقاق بيع سابق. */
export interface PackageTypeRecord extends PackageTypeTerms {
  readonly id: string;
  readonly business_id: string;
  readonly revision: number;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * يتحقق من قواعد تعريف الباقة المستقلة عن البيع؛ الخدمات المجانية والسعر فوق مجموعها مسموحان.
 *
 * @param terms التعريف الصافي، والسعر بالفلوس
 * @returns لا شيء عند القبول؛ يرفض بأول سبب مسمى قبل الكتابة
 */
export function validatePackageTypeDraft(terms: PackageTypeTerms): void {
  if (typeof terms.price !== 'bigint' || terms.price < 0n || terms.price > MONEY_MAX)
    throw new PackageTypeError('PACKAGE_TYPE_PRICE_INVALID');
  if (terms.components.length < 1 || terms.components.length > 20)
    throw new PackageTypeError('PACKAGE_TYPE_INVALID_COMPONENTS');
  const seen = new Set<string>();
  for (const component of terms.components) {
    if (component.service_id.length === 0)
      throw new PackageTypeError('PACKAGE_TYPE_INVALID_COMPONENTS');
    const key = component.service_id.toLowerCase();
    if (seen.has(key)) throw new PackageTypeError('PACKAGE_TYPE_DUPLICATE_SERVICE');
    seen.add(key);
    if (
      !Number.isSafeInteger(component.sessions) ||
      component.sessions < 1 ||
      component.sessions > 365
    )
      throw new PackageTypeError('PACKAGE_TYPE_INVALID_SESSIONS');
  }
  if (
    !Number.isInteger(terms.validity_days) ||
    terms.validity_days < 1 ||
    terms.validity_days > 730
  )
    throw new PackageTypeError('PACKAGE_TYPE_VALIDITY_INVALID');
  for (const name of [terms.name_en, terms.name_ar]) {
    if (
      name !== null &&
      (name.trim().length < 1 || name.trim().length > 255 || /\p{Cc}/u.test(name))
    )
      throw new PackageTypeError('PACKAGE_TYPE_NAME_INVALID');
  }
}

/**
 * يتحقق من النص الأصلي قبل تشذيب الأسماء وتوحيد معرفات الخدمات، ويُرجع حقول التعريف فقط دون بيانات الطلب.
 *
 * @param input حقول العقد كاملة، والاسم العربي اختياري عند الإنشاء فقط
 * @returns شروط متحققة والسعر bigint بالفلوس
 */
export function packageTypeTerms(
  input: Omit<PackageTypeTerms, 'price' | 'name_ar'> & {
    readonly price: string;
    readonly name_ar?: string | null | undefined;
  },
): PackageTypeTerms {
  let price: bigint;
  try {
    if (!/^(0|[1-9]\d{0,10})\.\d{3}$/.test(input.price)) throw new Error();
    price = parseMoney(input.price);
  } catch {
    throw new PackageTypeError('PACKAGE_TYPE_PRICE_INVALID');
  }
  validatePackageTypeDraft({ ...input, price, name_ar: input.name_ar ?? null });
  const terms = {
    price,
    name_en: input.name_en.trim(),
    name_ar: input.name_ar?.trim() ?? null,
    validity_days: input.validity_days,
    components: input.components.map((c) => ({
      service_id: c.service_id.toLowerCase(),
      sessions: c.sessions,
    })),
  };
  return terms;
}

/**
 * يبني النسخة الأولى بوقت ومعرف محقونين ليظل الإنشاء قابلاً للاختبار بدون ساعة النظام.
 *
 * @param terms الشروط المتحققة
 * @param id معرف النوع المحقون
 * @param businessId النشاط المالك
 * @param at وقت الإنشاء المحقون
 * @returns سجل النسخة الأولى
 */
export function newPackageType(
  terms: PackageTypeTerms,
  id: string,
  businessId: string,
  at: Date,
): PackageTypeRecord {
  return {
    ...terms,
    id,
    business_id: businessId,
    revision: 1,
    created_at: at.toISOString(),
    updated_at: at.toISOString(),
  };
}

/**
 * يرفض النسخة القديمة حتى في الطلب الخالي من التغييرات؛ تغيير ترتيب الخدمات تعديل فعلي.
 *
 * @param current السجل المقفول الحالي
 * @param terms الشروط البديلة كاملة
 * @param expectedRevision النسخة التي قرأها المدير
 * @param at وقت التعديل المحقون
 * @returns السجل التالي وقرار الكتابة والتدقيق
 */
export function planPackageTypeUpdate(
  current: PackageTypeRecord,
  terms: PackageTypeTerms,
  expectedRevision: number,
  at: Date,
): { after: PackageTypeRecord; changed: boolean } {
  if (expectedRevision !== current.revision)
    throw new PackageTypeError('PACKAGE_TYPE_REVISION_CONFLICT');
  validatePackageTypeDraft(terms);
  const changed =
    current.name_en !== terms.name_en ||
    current.name_ar !== terms.name_ar ||
    current.price !== terms.price ||
    current.validity_days !== terms.validity_days ||
    current.components.length !== terms.components.length ||
    current.components.some(
      (c, i) =>
        c.service_id !== terms.components[i]?.service_id ||
        c.sessions !== terms.components[i]?.sessions,
    );
  return {
    changed,
    after: changed
      ? { ...current, ...terms, revision: current.revision + 1, updated_at: at.toISOString() }
      : current,
  };
}

/**
 * يحفظ تعريف النوع فقط في التدقيق؛ أسعار الخدمات الحالية ليست جزءاً مما اشتراه العميل.
 *
 * @param record السجل الصافي
 * @returns نسخة JSON بسعر ثلاثي الخانات ومكونات مرتبة
 */
export function packageTypeSnapshot(record: PackageTypeRecord) {
  return {
    ...record,
    price: moneyToString(record.price),
    components: record.components.map((c) => ({ ...c })),
  };
}

/**
 * يتحقق أن كل خدمة قُرئت من نفس النشاط، ثم يضم أسماءها وأسعارها الحالية للعرض فقط.
 *
 * @param record سجل النوع
 * @param services الخدمات المقروءة ضمن النشاط والشركة
 * @returns تفاصيل النوع على السلك؛ الخدمة غير المعروفة ترفض التعريف كله
 */
export function packageTypeView(record: PackageTypeRecord, services: readonly PackageService[]) {
  const components = record.components.map((component) => {
    const service = services.find((s) => s.service_id === component.service_id);
    if (service === undefined) throw new PackageTypeError('PACKAGE_TYPE_SERVICE_NOT_FOUND');
    return {
      ...component,
      name_en: service.name_en,
      name_ar: service.name_ar,
      price: service.price,
    };
  });
  return { ...packageTypeSnapshot(record), components };
}
