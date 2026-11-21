import { moneyToString } from '@pospay/domain';

import { ServiceError } from './errors.ts';
import type { ServiceImportRowColumn, ServiceImportRowErrorCode } from './service-import.ts';
import type { ServiceCommissionRule } from './service-commission-rule.ts';
import { serviceTerms, toRuleWire, type ServiceRuleWire } from './service.ts';

/** الصف المطبّع (D-9/FR-014): المال نص ثلاثي الخانات وقيمة القاعدة عدد bps أو نص مبلغ أو فراغ. */
export interface ServiceImportNormalizedRow {
  readonly row: number;
  readonly name_en: string;
  readonly name_ar: string | null;
  readonly price: string;
  readonly duration_minutes: number | null;
  readonly category_id: string | null;
  readonly category_name_en: string | null;
  readonly commission_rule: ServiceRuleWire;
  readonly commission_value: number | string | null;
  readonly commission_rule_defaulted: boolean;
  readonly counts_toward_threshold: boolean;
}

/** مدخلات الفحص النهائي: كل الحقول المحوّلة والقاعدة الصافية المقبولة. */
export interface FinalRowInput {
  readonly nameEn: string;
  readonly nameAr: string | null;
  readonly price: string;
  readonly duration: number | null;
  readonly category: { readonly id: string; readonly nameEn: string } | null;
  readonly rule: ServiceCommissionRule;
  readonly defaulted: boolean;
  readonly counts: boolean;
}

/** نتيجة الفحص النهائي: الصف المطبّع، أو خطأ واحد على عمود واحد. */
export type FinalRowOutcome =
  | { readonly ok: true; readonly row: ServiceImportNormalizedRow }
  | { readonly ok: false; readonly column: ServiceImportRowColumn; readonly code: ServiceImportRowErrorCode };

/**
 * بيبني الصف المطبّع بعد الفحص النهائي بنفس دالة الإنشاء (SR-006)، وأول خطأ منها بترجع لعمودها
 * بالشكل المتفق عليه في A-7، والصف بيبني بقاعدة على السلك وقيمة مرتبطة بنوعها.
 *
 * @param row   رقم الصف الأصلي في الورقة
 * @param input كل الحقول المحوّلة والقاعدة الصافية المقبولة
 * @returns الصف المطبّع، أو خطأ واحد على عمود واحد
 */
export function buildNormalizedRow(row: number, input: FinalRowInput): FinalRowOutcome {
  const wire = toRuleWire(input.rule);
  try {
    serviceTerms({
      name_en: input.nameEn,
      name_ar: input.nameAr,
      price: input.price,
      commission_rule: wire,
      counts_toward_threshold: input.counts,
      duration_minutes: input.duration,
      category_id: input.category?.id ?? null,
    });
  } catch (error) {
    if (!(error instanceof ServiceError)) throw error;
    return finalCheckIssue(error.code, error);
  }
  return {
    ok: true,
    row: {
      row,
      name_en: input.nameEn,
      name_ar: input.nameAr,
      price: input.price,
      duration_minutes: input.duration,
      category_id: input.category?.id ?? null,
      category_name_en: input.category?.nameEn ?? null,
      commission_rule: wire,
      commission_value: commissionValue(input.rule),
      commission_rule_defaulted: input.defaulted,
      counts_toward_threshold: input.counts,
    },
  };
}

// أكواد A-7 الستة فقط هي المتوقعة من الفحص النهائي؛ أي كود تاني خطأ برمجي حقيقي فيعاد إرميه كما هو
// بدل إعادة تصنيفه خطأ تصنيف أو اسم، فما بنبلعش فشل مش متوقع ولا بنمثله خطأ صف.
function finalCheckIssue(code: ServiceError['code'], original: ServiceError): FinalRowOutcome {
  switch (code) {
    case 'SERVICE_NAME_INVALID':
      return { ok: false, column: 'name_en', code: 'IMPORT_NAME_INVALID' };
    case 'SERVICE_PRICE_INVALID':
      return { ok: false, column: 'price', code: 'IMPORT_PRICE_INVALID' };
    case 'SERVICE_COMMISSION_RULE_INVALID':
      return { ok: false, column: 'commission_value', code: 'IMPORT_COMMISSION_VALUE_INVALID' };
    case 'SERVICE_DURATION_INVALID':
      return { ok: false, column: 'duration_minutes', code: 'IMPORT_DURATION_INVALID' };
    case 'SERVICE_CATEGORY_NOT_FOUND':
    case 'SERVICE_CATEGORY_CLOSED':
      return { ok: false, column: 'category', code: 'IMPORT_CATEGORY_NOT_FOUND' };
    default:
      throw original;
  }
}

function commissionValue(rule: ServiceCommissionRule): number | string | null {
  if (rule.kind === 'PCT') return Number(rule.value);
  if (rule.kind === 'FIXED') return moneyToString(rule.value);
  return null;
}
