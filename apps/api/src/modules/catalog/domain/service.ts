import { moneyToString, parseMoney } from '@pospay/domain';

import { ServiceError } from './errors.ts';
import { normalizeUuid } from './service-category-assignment.ts';
import type { ServiceCommissionRule } from './service-commission-rule.ts';
import { validateServiceDraft } from './service-validation.ts';

/** شكل قاعدة العمولة على السلك: النسبة عدد صحيح bps، والمبلغ الثابت نص KWD؛ النوع الصافي ملك نطاق catalog. */
export type ServiceRuleWire =
  | { readonly kind: 'FOLLOW_PLAN' }
  | { readonly kind: 'ZERO' }
  | { readonly kind: 'PCT'; readonly value: number }
  | { readonly kind: 'FIXED'; readonly value: string };

/** بنود الخدمة الصافية بالفلوس؛ نفس الشكل يستخدمه الإنشاء والتعديل والاستيراد (32b). */
export interface ServiceTerms {
  readonly name_en: string;
  readonly name_ar: string | null;
  readonly price: bigint;
  readonly commission_rule: ServiceCommissionRule;
  readonly counts_toward_threshold: boolean;
  readonly duration_minutes: number | null;
  readonly category_id: string | null;
}

/** بنود الخدمة كما وصلت من العقد؛ الحقول الغائبة تعني "ما اتقالش" مش "فارغ". */
export interface ServiceTermsInput {
  readonly name_en: string;
  readonly name_ar?: string | null | undefined;
  readonly price: string;
  readonly commission_rule: ServiceRuleWire;
  // الافتراضي الحقيقي (تُحتسب) بيتطبق في serviceTerms عشان العميل يقدر يسيبه.
  readonly counts_toward_threshold?: boolean | undefined;
  readonly duration_minutes?: number | null | undefined;
  readonly category_id?: string | null | undefined;
}

/** سجل الخدمة المخزّن كما يقرأه النطاق؛ المال فلوس (bigint) والقاعدة نوعها الصافي. */
export interface ServiceRecord extends ServiceTerms {
  readonly id: string;
  readonly business_id: string;
  readonly revision: number;
  readonly created_at: string;
  readonly updated_at: string;
}

/** نسخة الخدمة للنقل في JSON: السعر نص والقاعدة بقيمتها على السلك. */
export interface ServiceView extends Omit<ServiceRecord, 'price' | 'commission_rule'> {
  readonly price: string;
  readonly commission_rule: ServiceRuleWire;
}

/** تسمية التصنيف كما ترد مع الخدمة: الاسمان ووقت الإغلاق. */
export interface ServiceCategoryLabel {
  readonly name_en: string;
  readonly name_ar: string;
  readonly closed_at: string | null;
}

/** رد الخدمة: نسخة الخدمة مع تسمية التصنيف اللي تحتها. */
export interface ServiceResponse extends ServiceView {
  readonly category: ServiceCategoryLabel | null;
}

/**
 * يحوّل سعر الخدمة من نص KWD ثلاثي الخانات إلى فلوس؛ الرفض مسمّى ولا يسرب النص في الخطأ.
 *
 * @param text السعر القادم من العقد بالشكل "0.000" أو "12.500"
 * @returns السعر بالفلوس (1 دينار = 1000 فلس)
 */
export function parseServicePrice(text: string): bigint {
  try {
    if (!/^(0|[1-9]\d{0,10})\.\d{3}$/.test(text)) throw new ServiceError('SERVICE_PRICE_INVALID');
    return parseMoney(text);
  } catch {
    throw new ServiceError('SERVICE_PRICE_INVALID');
  }
}

/**
 * يبني البنود الصافية من مدخلات العقد: تشذيب الأسماء، تحويل السعر للفلوس، وتحويل القاعدة للنوع الصافي.
 * معرّف التصنيف بيتخزّن بحروف صغيرة عشان يطابق الصف اللي بترجّعه قاعدة البيانات.
 *
 * @param input مدخلات الإنشاء أو التعديل كما جاءت من العقد
 * @returns البنود الصافية المتحققة
 */
export function serviceTerms(input: ServiceTermsInput): ServiceTerms {
  const terms: ServiceTerms = {
    name_en: input.name_en.trim(),
    name_ar: input.name_ar === undefined || input.name_ar === null ? null : input.name_ar.trim(),
    price: parseServicePrice(input.price),
    commission_rule: toCommissionRule(input.commission_rule),
    counts_toward_threshold: input.counts_toward_threshold ?? true,
    duration_minutes: input.duration_minutes ?? null,
    category_id: normalizeUuid(input.category_id ?? null),
  };
  validateServiceDraft(terms);
  return terms;
}

/**
 * يبني بنود التعديل بدمج الحقول الغائبة مع المخزّن: الغياب يعني الإبقاء و`null` يعني المسح.
 * الدمج شغل النطاق مش الـ use case، عشان القواعد تفضل في مكان واحد ومختبَرة من غير قاعدة بيانات.
 *
 * @param input مدخلات التعديل كما جاءت من العقد
 * @param current السجل الحالي المقفول
 * @returns البنود الصافية بعد الدمج
 */
export function serviceUpdateTerms(input: ServiceTermsInput, current: ServiceRecord): ServiceTerms {
  return serviceTerms({
    ...input,
    duration_minutes:
      input.duration_minutes === undefined ? current.duration_minutes : input.duration_minutes,
    category_id: input.category_id === undefined ? current.category_id : input.category_id,
  });
}

/**
 * يبني سجل خدمة جديداً بنسخة أولى ووقت واحد محقون.
 *
 * @param terms البنود الصافية المتحققة
 * @param id معرف UUID v7 محقون
 * @param businessId النشاط المالك للخدمة
 * @param at الوقت المحقون
 * @returns السجل الجاهز للإدخال
 */
export function newService(
  terms: ServiceTerms,
  id: string,
  businessId: string,
  at: Date,
): ServiceRecord {
  const iso = at.toISOString();
  return {
    ...terms,
    id,
    business_id: businessId,
    revision: 1,
    created_at: iso,
    updated_at: iso,
  };
}

/**
 * يخطط تعديل الخدمة: يرفض النسخة القديمة ويبني النسخة التالية فقط لو اتغير حاجة فعلية.
 * مقارنة القيم جوه النطاق عشان الـ use case يفضل خطوات محضة.
 *
 * @param current السجل الحالي المقفول
 * @param terms البنود الصافية الجديدة
 * @param expectedRevision النسخة اللي العميل شافها
 * @param at الوقت المحقون
 * @returns السجل بعد التعديل وهل اتغير فعلاً
 */
export function planServiceUpdate(
  current: ServiceRecord,
  terms: ServiceTerms,
  expectedRevision: number,
  at: Date,
): { readonly after: ServiceRecord; readonly changed: boolean } {
  if (expectedRevision !== current.revision) throw new ServiceError('SERVICE_REVISION_CONFLICT');
  validateServiceDraft(terms);
  if (sameTerms(current, terms)) return { after: current, changed: false };
  return {
    after: {
      ...current,
      ...terms,
      revision: current.revision + 1,
      updated_at: at.toISOString(),
    },
    changed: true,
  };
}

/**
 * يحوّل السجل للشكل المنقول في JSON: السعر نص ثلاثي الخانات والقاعدة بقيمتها على السلك.
 *
 * @param record سجل النطاق
 * @returns نسخة الخدمة للعقد
 */
export function serviceSnapshot(record: ServiceRecord): ServiceView {
  return {
    ...record,
    price: moneyToString(record.price),
    commission_rule: toRuleWire(record.commission_rule),
  };
}

/**
 * يبني رد الخدمة: نسخة الخدمة مع تسمية التصنيف اللي تحتها.
 * التسمية بتتبني من الأسماء والإغلاق بس، فالحقول التانية في الصف المقفول (المعرّف والنشاط) ما بتوصلش للرد.
 * التدقيق بيستخدم serviceSnapshot بدل ده، فسجل التدقيق مبياخدش أسماء التصنيفات.
 *
 * @param record سجل النطاق بعد الحفظ
 * @param category صف التصنيف المقفول، أو `null` لو الخدمة من غير تصنيف
 * @returns رد الخدمة جاهز للعقد
 */
export function serviceResponse(
  record: ServiceRecord,
  category: ServiceCategoryLabel | null,
): ServiceResponse {
  const label =
    record.category_id === null || category === null
      ? null
      : {
          name_en: category.name_en,
          name_ar: category.name_ar,
          closed_at: category.closed_at,
        };
  return {
    ...serviceSnapshot(record),
    category: label,
  };
}

/**
 * يحوّل قاعدة العمولة من شكل السلك للنوع الصافي: PCT نقاط أساس، وFIXED فلوس.
 *
 * @param rule القاعدة كما جاءت من العقد
 * @returns القاعدة الصافية
 */
export function toCommissionRule(rule: ServiceRuleWire): ServiceCommissionRule {
  if (rule.kind === 'PCT') {
    if (!Number.isInteger(rule.value) || rule.value < 0 || rule.value > 10_000)
      throw new ServiceError('SERVICE_COMMISSION_RULE_INVALID');
    return { kind: 'PCT', value: BigInt(rule.value) };
  }
  if (rule.kind === 'FIXED') {
    try {
      return { kind: 'FIXED', value: parseServicePrice(rule.value) };
    } catch {
      throw new ServiceError('SERVICE_COMMISSION_RULE_INVALID');
    }
  }
  if ('value' in rule) throw new ServiceError('SERVICE_COMMISSION_RULE_INVALID');
  return { kind: rule.kind };
}

function toRuleWire(rule: ServiceCommissionRule): ServiceRuleWire {
  if (rule.kind === 'PCT') return { kind: 'PCT', value: Number(rule.value) };
  if (rule.kind === 'FIXED') return { kind: 'FIXED', value: moneyToString(rule.value) };
  return { kind: rule.kind };
}

function sameTerms(current: ServiceRecord, terms: ServiceTerms): boolean {
  return (
    current.name_en === terms.name_en &&
    current.name_ar === terms.name_ar &&
    current.price === terms.price &&
    current.counts_toward_threshold === terms.counts_toward_threshold &&
    current.duration_minutes === terms.duration_minutes &&
    current.category_id === terms.category_id &&
    sameRule(current.commission_rule, terms.commission_rule)
  );
}

function sameRule(a: ServiceCommissionRule, b: ServiceCommissionRule): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'PCT' && b.kind === 'PCT') return a.value === b.value;
  if (a.kind === 'FIXED' && b.kind === 'FIXED') return a.value === b.value;
  return true;
}
