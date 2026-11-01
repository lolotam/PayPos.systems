import { service, serviceListItem, type Service, type ServiceListItem } from '@pospay/contracts';

export type ServiceListRow = {
  readonly id: string;
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
  readonly category_name_en: string | null;
  readonly category_name_ar: string | null;
  readonly category_closed_at: string | null;
};

export type ServiceDetailRow = ServiceListRow & {
  readonly business_id: string;
  readonly created_at: string;
  readonly updated_at: string;
};

/** يبني قاعدة العمولة على السلك من أعمدة متسقة؛ مسار القراءة مالوش قواعد بيزنس يفسّرها. */
export function ruleFrom(row: {
  readonly commission_rule_kind: string;
  readonly commission_pct_bps: number | null;
  readonly commission_fixed_amount: string | null;
}) {
  if (row.commission_rule_kind === 'PCT')
    return { kind: 'PCT' as const, value: row.commission_pct_bps ?? 0 };
  if (row.commission_rule_kind === 'FIXED')
    return { kind: 'FIXED' as const, value: row.commission_fixed_amount ?? '0.000' };
  if (row.commission_rule_kind === 'ZERO') return { kind: 'ZERO' as const };
  return { kind: 'FOLLOW_PLAN' as const };
}

/**
 * يبني تسمية التصنيف من أعمدة الانضمام؛ الـ null بالظبط معناه إن الخدمة من غير تصنيف.
 * الانضمام LEFT JOIN، فالتصنيف غير الموجود بيسيب الأعمدة كلها فاضية.
 */
export function categoryFrom(row: {
  readonly category_id: string | null;
  readonly category_name_en: string | null;
  readonly category_name_ar: string | null;
  readonly category_closed_at: string | null;
}): {
  readonly name_en: string;
  readonly name_ar: string;
  readonly closed_at: string | null;
} | null {
  if (row.category_id === null) return null;
  return {
    name_en: row.category_name_en ?? '',
    name_ar: row.category_name_ar ?? '',
    closed_at: row.category_closed_at,
  };
}

/** إسقاط صف واحد في شكل بند القائمة المتفق عليه مع العقد. */
export function toServiceListItem(row: ServiceListRow): ServiceListItem {
  return serviceListItem.parse({
    id: row.id,
    name_en: row.name_en,
    name_ar: row.name_ar,
    price: row.price,
    commission_rule: ruleFrom(row),
    counts_toward_threshold: row.counts_toward_threshold,
    duration_minutes: row.duration_minutes,
    category_id: row.category_id,
    category: categoryFrom(row),
    revision: row.revision,
  });
}

/** إسقاط صف واحد في شكل الخدمة الكامل. */
export function toService(row: ServiceDetailRow): Service {
  return service.parse({
    id: row.id,
    business_id: row.business_id,
    name_en: row.name_en,
    name_ar: row.name_ar,
    price: row.price,
    commission_rule: ruleFrom(row),
    counts_toward_threshold: row.counts_toward_threshold,
    duration_minutes: row.duration_minutes,
    category_id: row.category_id,
    category: categoryFrom(row),
    revision: row.revision,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}
