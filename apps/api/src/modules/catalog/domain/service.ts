import { MONEY_MAX, moneyToString, parseMoney } from '@pospay/domain';

import { ServiceError } from './errors.ts';
import type { ServiceCommissionRule } from './service-commission-rule.ts';

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
}

interface ServiceTermsInput {
  readonly name_en: string;
  readonly name_ar?: string | null | undefined;
  readonly price: string;
  readonly commission_rule: ServiceRuleWire;
  // الافتراضي الحقيقي (تُحتسب) بيتطبق في serviceTerms عشان العميل يقدر يسيبه.
  readonly counts_toward_threshold?: boolean | undefined;
}

interface ServiceRowInput {
  readonly id: string;
  readonly business_id: string;
  readonly name_en: string;
  readonly name_ar: string | null;
  readonly price: string;
  readonly commission_rule_kind: string;
  readonly commission_pct_bps: number | null;
  readonly commission_fixed_amount: string | null;
  readonly counts_toward_threshold: boolean;
  readonly revision: number;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
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
 * يتحقق من أسماء الخدمة: الإنجليزي إجباري والعربي اختياري، والطول من 1 إلى 255 بعد التشذيب.
 *
 * @param nameEn الاسم الإنجليزي
 * @param nameAr الاسم العربي أو غيابه
 * @returns لا شيء عند القبول، ويرفض بخطأ مسمّى
 */
export function validateServiceName(nameEn: string, nameAr: string | null): void {
  if (nameEn.trim().length < 1 || nameEn.length > 255 || /\p{Cc}/u.test(nameEn))
    throw new ServiceError('SERVICE_NAME_INVALID');
  if (
    nameAr !== null &&
    (nameAr.trim().length < 1 || nameAr.length > 255 || /\p{Cc}/u.test(nameAr))
  )
    throw new ServiceError('SERVICE_NAME_INVALID');
}

/**
 * يتحقق من قاعدة العمولة: PCT نقاط أساس 0–10000، FIXED فلوس غير سالبة داخل numeric(14,3)؛
 * FOLLOW_PLAN وZERO بلا قيمة. المعاني يحددها SPEC §5، والنوع ملك نطاق catalog.
 *
 * @param rule القاعدة الصافية
 * @returns لا شيء عند القبول، ويرفض بخطأ مسمّى
 */
export function validateServiceCommissionRule(rule: ServiceCommissionRule): void {
  const invalid = () => {
    throw new ServiceError('SERVICE_COMMISSION_RULE_INVALID');
  };
  if (typeof rule !== 'object' || rule === null) return invalid();
  switch (rule.kind) {
    case 'FOLLOW_PLAN':
    case 'ZERO':
      if ('value' in rule) invalid();
      return;
    case 'PCT':
    case 'FIXED':
      if (
        typeof rule.value !== 'bigint' ||
        rule.value < 0n ||
        rule.value > (rule.kind === 'PCT' ? 10_000n : MONEY_MAX)
      )
        invalid();
      return;
    default:
      return invalid();
  }
}

/**
 * يتحقق من بنود الخدمة كاملة قبل أي كتابة؛ دالة الاستيراد (32b) تنادي نفس الفحص لكل صف.
 *
 * @param terms البنود الصافية بالفلوس
 * @returns لا شيء عند القبول، ويرفض بأول خطأ مسمّى
 */
export function validateServiceDraft(terms: ServiceTerms): void {
  validateServiceName(terms.name_en, terms.name_ar);
  if (typeof terms.price !== 'bigint' || terms.price < 0n || terms.price > MONEY_MAX)
    throw new ServiceError('SERVICE_PRICE_INVALID');
  validateServiceCommissionRule(terms.commission_rule);
}

/**
 * يبني البنود الصافية من مدخلات العقد: تشذيب الأسماء، تحويل السعر للفلوس، وتحويل القاعدة للنوع الصافي.
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
  };
  validateServiceDraft(terms);
  return terms;
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
 * يبني سجل النطاق من صف قاعدة البيانات، بحيث تفضل أعمدة السعر والقاعدة مفسّرة في مكان واحد
 * ومفيش تحويل فلوس جوه طبقة الـ persistence.
 *
 * @param row الصف الخام بأعمدة snake_case
 * @returns سجل النطاق بالفلوس والقاعدة الصافية
 */
export function serviceRecordFromRow(row: ServiceRowInput): ServiceRecord {
  return {
    id: row.id,
    business_id: row.business_id,
    name_en: row.name_en,
    name_ar: row.name_ar,
    price: parseServicePrice(row.price),
    commission_rule: rowToRule(row),
    counts_toward_threshold: row.counts_toward_threshold,
    revision: row.revision,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}

/**
 * يحوّل السجل لأعمدة قاعدة البيانات البدائية: السعر نص، والقاعدة موزّعة على أعمدة متسقة.
 * الـ persistence بيكتب الناتج زي ما هو، فالتحويل المالي مكانه واحد.
 *
 * @param record سجل النطاق
 * @returns قيم الأعمدة الجاهزة للإدخال أو التحديث
 */
export function serviceColumnValues(record: ServiceRecord): {
  readonly price: string;
  readonly commission_rule_kind: string;
  readonly commission_pct_bps: number | null;
  readonly commission_fixed_amount: string | null;
} {
  return {
    price: moneyToString(record.price),
    commission_rule_kind: record.commission_rule.kind,
    commission_pct_bps:
      record.commission_rule.kind === 'PCT' ? Number(record.commission_rule.value) : null,
    commission_fixed_amount:
      record.commission_rule.kind === 'FIXED' ? moneyToString(record.commission_rule.value) : null,
  };
}

function rowToRule(row: {
  readonly commission_rule_kind: string;
  readonly commission_pct_bps: number | null;
  readonly commission_fixed_amount: string | null;
}): ServiceCommissionRule {
  if (row.commission_rule_kind === 'PCT')
    return { kind: 'PCT', value: BigInt(row.commission_pct_bps ?? 0) };
  if (row.commission_rule_kind === 'FIXED')
    return { kind: 'FIXED', value: parseServicePrice(row.commission_fixed_amount ?? '0.000') };
  if (row.commission_rule_kind === 'ZERO') return { kind: 'ZERO' };
  return { kind: 'FOLLOW_PLAN' };
}

function toCommissionRule(rule: ServiceRuleWire): ServiceCommissionRule {
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
    sameRule(current.commission_rule, terms.commission_rule)
  );
}

function sameRule(a: ServiceCommissionRule, b: ServiceCommissionRule): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'PCT' && b.kind === 'PCT') return a.value === b.value;
  if (a.kind === 'FIXED' && b.kind === 'FIXED') return a.value === b.value;
  return true;
}
