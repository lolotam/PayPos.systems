import {
  commissionServiceOverrideList,
  commissionServiceOverrideListItem,
  type CommissionServiceOverrideList,
  type CommissionServiceOverrideListItem,
  type CommissionServiceOverrideListQuery,
  type CommissionServiceOverrideRuleView,
} from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import {
  decodeCommissionServiceOverrideCursor,
  encodeCommissionServiceOverrideCursor,
  type CommissionServiceOverrideCursorContext,
  type CommissionServiceOverrideCursorPosition,
} from './commission-service-override-cursor.ts';

/** توكن المزود: المصنع اللي بيرجّع قراءات المسار السريع على معاملة القارئ نفسها. */
export const COMMISSION_SERVICE_OVERRIDE_LIST_READS = Symbol('COMMISSION_SERVICE_OVERRIDE_LIST_READS');

/** قراءات مسار القائمة: توقيت النشاط ووجود الموظفة، من الوحدات المالكة للبيانات. */
export interface CommissionServiceOverrideListReads {
  /**
   * بيرجّع توقيت النشاط عشان تاريخ اليوم المحسوب في الداتابيز يطلع بتوقيت النشاط.
   *
   * @param companyId  الشركة المفتوحة في معاملة القراءة
   * @param businessId النشاط المطلوب
   * @returns التوقيت، أو null لو النشاط مش موجود
   */
  timeZone(companyId: string, businessId: string): Promise<string | null>;
  /**
   * يقول إن الموظفة موجودة في النشاط وباقية.
   *
   * @param companyId  الشركة المفتوحة في معاملة القراءة
   * @param businessId النشاط المطلوب
   * @param employeeId الموظفة المطلوبة
   * @returns true عند وجود الموظفة النشطة
   */
  employeeExists(companyId: string, businessId: string, employeeId: string): Promise<boolean>;
}

export type CommissionServiceOverrideListReadsFactory = (tx: Tx) => CommissionServiceOverrideListReads;

/** رفضات القراءة: خطأ معروف بيتحول لخطأ API معروف، من غير أي بيانات جوه. */
export class CommissionServiceOverrideReadError extends Error {
  readonly code: 'VALIDATION_FAILED' | 'EMPLOYEE_NOT_FOUND' | 'FORBIDDEN';

  constructor(code: 'VALIDATION_FAILED' | 'EMPLOYEE_NOT_FOUND' | 'FORBIDDEN') {
    super(code);
    this.name = 'CommissionServiceOverrideReadError';
    this.code = code;
  }
}

/** نطاق القراءة: النشاط والموظفة والفلتر الاختياري. */
export interface CommissionServiceOverrideListScope {
  readonly companyId: string;
  readonly businessId: string;
  readonly employeeId: string;
  readonly serviceId: string | undefined;
}

type OverrideRow = {
  readonly id: string;
  readonly employee_id: string;
  readonly service_id: string;
  readonly rule: CommissionServiceOverrideRuleView;
  readonly effective_from: string;
  readonly created_at: string;
  readonly created_at_us: string;
  readonly created_by: string;
  readonly is_current: boolean;
};

function cursorContext(scope: CommissionServiceOverrideListScope): CommissionServiceOverrideCursorContext {
  return {
    companyId: scope.companyId,
    businessId: scope.businessId,
    employeeId: scope.employeeId,
    serviceId: scope.serviceId,
  };
}

// تاريخ اليوم بتوقيت النشاط، محسوب في الداتابيز جوه نفس معاملة القراءة.
const businessToday = (timeZone: string) => sql`(CURRENT_TIMESTAMP AT TIME ZONE ${timeZone})::date`;

function serviceFilter(scope: CommissionServiceOverrideListScope) {
  return scope.serviceId === undefined ? sql`` : sql`AND o.service_id = ${scope.serviceId}`;
}

// الترتيب: خدمة أكبر، أو نفس الخدمة و(وقت، معرّف) أصغر.
function cursorClause(cursor: CommissionServiceOverrideCursorPosition | null) {
  if (cursor === null) return sql``;
  // معامل timestamptz يمر عبر Date في postgres.js؛ معامل text يحفظ الميكروثانية لحد التحويل داخل PostgreSQL.
  return sql`AND (o.service_id > ${cursor.serviceId} OR (o.service_id = ${cursor.serviceId}
    AND (o.created_at, o.id) < (${cursor.createdAt}::text::timestamptz, ${cursor.id}::uuid)))`;
}

/**
 * جملة قائمة تجاوزات الخدمة: الشاشة بتعرض السطر الحالي والتاريخي للموظفة.
 * الترتيب خدمة تصاعدي وبعدين وقت الحفظ تنازلي والمعرّف تنازلي.
 */
export function commissionServiceOverridesStatement(
  scope: CommissionServiceOverrideListScope,
  query: CommissionServiceOverrideListQuery,
  timeZone: string,
) {
  const decoded = decodeCommissionServiceOverrideCursor(query.cursor, cursorContext(scope));
  if (decoded.kind === 'invalid') throw new CommissionServiceOverrideReadError('VALIDATION_FAILED');
  const cursor = decoded.kind === 'valid' ? decoded.position : null;
  const today = businessToday(timeZone);
  return sql`SELECT o.id,o.employee_id,o.service_id,
    CASE o.rule_kind
      WHEN 'PCT' THEN jsonb_build_object('kind',o.rule_kind,'value',o.rule_pct_bps)
      WHEN 'FIXED' THEN jsonb_build_object('kind',o.rule_kind,'value',o.rule_fixed_amount::text)
      ELSE jsonb_build_object('kind',o.rule_kind) END AS rule,
    to_char(o.effective_from,'YYYY-MM-DD') AS effective_from,
    to_char(o.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
    to_char(o.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_us,
    o.created_by,
    (o.effective_from <= ${today} AND NOT EXISTS (
      SELECT 1 FROM commission_service_overrides c
      WHERE c.company_id = o.company_id AND c.business_id = o.business_id
        AND c.employee_id = o.employee_id AND c.service_id = o.service_id
        AND c.effective_from <= ${today}
        AND (c.created_at, c.id) > (o.created_at, o.id)
    )) AS is_current
    FROM commission_service_overrides o
    WHERE o.company_id = ${scope.companyId} AND o.business_id = ${scope.businessId}
      AND o.employee_id = ${scope.employeeId} ${serviceFilter(scope)} ${cursorClause(cursor)}
    ORDER BY o.service_id ASC, o.created_at DESC NULLS LAST, o.id DESC NULLS LAST LIMIT ${query.limit + 1}`;
}

function itemOf(row: OverrideRow): CommissionServiceOverrideListItem {
  return commissionServiceOverrideListItem.parse({
    id: row.id,
    employee_id: row.employee_id,
    service_id: row.service_id,
    rule: row.rule,
    effective_from: row.effective_from,
    created_at: row.created_at,
    created_by: row.created_by,
    is_current: row.is_current,
  });
}

/**
 * يقرأ قائمة تجاوزات الخدمة للموظفة: السطر الحالي والتاريخي، بصفحات مفتاحية.
 *
 * @param tx    معاملة القراءة نفسها، عشان مفيش معاملة تانية
 * @param reads قراءات المزود على نفس المعاملة
 * @param scope النطاق: الشركة والنشاط والموظفة والفلتر الاختياري
 * @param query الاستعلام: الفلتر والمؤشر والحد
 * @returns صفحة القائمة مع المؤشر اللي بياخد الصفحة الجاية
 */
export async function listCommissionServiceOverrides(
  tx: Tx,
  reads: CommissionServiceOverrideListReads,
  scope: CommissionServiceOverrideListScope,
  query: CommissionServiceOverrideListQuery,
): Promise<CommissionServiceOverrideList> {
  if (!(await reads.employeeExists(scope.companyId, scope.businessId, scope.employeeId))) {
    throw new CommissionServiceOverrideReadError('EMPLOYEE_NOT_FOUND');
  }
  const timeZone = await reads.timeZone(scope.companyId, scope.businessId);
  if (timeZone === null) throw new CommissionServiceOverrideReadError('FORBIDDEN');
  const rows = await tx.execute<OverrideRow>(
    commissionServiceOverridesStatement(scope, query, timeZone),
  );
  const page = rows.slice(0, query.limit);
  const items = page.map(itemOf);
  const last = page.at(-1);
  const next_cursor =
    rows.length > query.limit && last !== undefined
      ? encodeCommissionServiceOverrideCursor(cursorContext(scope), {
          serviceId: last.service_id,
          createdAt: last.created_at_us,
          id: last.id,
        })
      : null;
  return commissionServiceOverrideList.parse({ items, next_cursor });
}
