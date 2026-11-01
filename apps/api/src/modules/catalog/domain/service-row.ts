import { moneyToString } from '@pospay/domain';

import type { ServiceCommissionRule } from './service-commission-rule.ts';
import type { ServiceRecord } from './service.ts';
import { parseServicePrice } from './service.ts';

/** صف الخدمة الخام بأعمدة snake_case كما تخرج من قاعدة البيانات. */
export interface ServiceRowInput {
  readonly id: string;
  readonly business_id: string;
  readonly name_en: string;
  readonly name_ar: string | null;
  readonly price: string;
  readonly commission_rule_kind: string;
  readonly commission_pct_bps: number | null;
  readonly commission_fixed_amount: string | null;
  readonly counts_toward_threshold: boolean;
  readonly duration_minutes: number | null;
  readonly category_id: string | null;
  readonly revision: number;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
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
    duration_minutes: row.duration_minutes,
    category_id: row.category_id,
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
  readonly duration_minutes: number | null;
  readonly category_id: string | null;
} {
  return {
    price: moneyToString(record.price),
    commission_rule_kind: record.commission_rule.kind,
    commission_pct_bps:
      record.commission_rule.kind === 'PCT' ? Number(record.commission_rule.value) : null,
    commission_fixed_amount:
      record.commission_rule.kind === 'FIXED' ? moneyToString(record.commission_rule.value) : null,
    duration_minutes: record.duration_minutes,
    category_id: record.category_id,
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
