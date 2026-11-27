import {
  commissionBlockedCorrection,
  commissionBlockedCorrectionList,
  type CommissionBlockedCorrection,
  type CommissionBlockedCorrectionList,
  type CommissionBlockedCorrectionListQuery,
  type CommissionBlockedCorrectionStatus,
} from '@pospay/contracts';
import type { TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import {
  decodeCommissionBlockedCorrectionCursor,
  encodeCommissionBlockedCorrectionCursor,
  type CommissionBlockedCorrectionCursorPosition,
} from './commission-blocked-corrections-cursor.ts';

/** توكن المزود: المصنع اللي بيرجّع قائمة التصحيحات الموقوفة على معاملة القارئ نفسها. */
export const COMMISSION_BLOCKED_CORRECTION_LIST = Symbol('COMMISSION_BLOCKED_CORRECTION_LIST');

/** قراءات قائمة التصحيحات الموقوفة على معاملة واحدة: إعادة فحص الصلاحية والميزة قبل أي صف. */
export interface CommissionBlockedCorrectionListReads {
  /** بيعيد فحص الصلاحية والميزة على معاملة القائمة قبل قراءة أي تصحيح موقوف. */
  access(
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
  ): Promise<'FORBIDDEN' | 'FEATURE_DISABLED' | null>;
}

export type CommissionBlockedCorrectionReadCode =
  'VALIDATION_FAILED' | 'FORBIDDEN' | 'FEATURE_DISABLED';

/** رفضات القراءة: خطأ معروف بيتحول لخطأ API معروف، من غير أي بيانات جوه. */
export class CommissionBlockedCorrectionReadError extends Error {
  readonly code: CommissionBlockedCorrectionReadCode;

  constructor(code: CommissionBlockedCorrectionReadCode) {
    super(code);
    this.name = 'CommissionBlockedCorrectionReadError';
    this.code = code;
  }
}

/** عدّاد قائمة التصحيحات الموقوفة: اللي بتستهلكه شاشة التصحيحات الموقوفة في شاشات خطط العمولة (FR-049). */
export type CommissionBlockedCorrectionListRunner = (
  actor: { readonly companyId: string; readonly userId: string },
  businessId: string,
  query: CommissionBlockedCorrectionListQuery,
) => Promise<CommissionBlockedCorrectionList>;

type BlockedCorrectionRow = {
  readonly id: string;
  readonly employee_id: string;
  readonly source_period: string;
  readonly code: string;
  readonly target_period: string;
  readonly created_at: string;
  readonly created_at_us: string;
  readonly resolved_at: string | null;
};

// الفلتر على حالة الحل: المفتوح هو الافتراضي عشان الشاشة بتفتح على الواجب الناقص.
function statusClause(status: CommissionBlockedCorrectionStatus) {
  if (status === 'open') return sql`AND resolved_at IS NULL`;
  if (status === 'resolved') return sql`AND resolved_at IS NOT NULL`;
  return sql``;
}

// الترتيب created_at DESC, id DESC؛ زوج المقارنة بيلحق نفس التوقيت بترتيب المعرّف ثابت.
function cursorClause(cursor: CommissionBlockedCorrectionCursorPosition | null) {
  if (cursor === null) return sql``;
  // معامل text يحفظ الميكروثانية لحد التحويل داخل PostgreSQL، زي قايمة التجاوزات.
  return sql`AND (created_at, id) < (${cursor.createdAt}::text::timestamptz, ${cursor.id}::uuid)`;
}

/** نطاق القائمة: النشاط المطلوب وفلتر حالة الحل. */
export interface CommissionBlockedCorrectionListScope {
  readonly companyId: string;
  readonly businessId: string;
  readonly status: CommissionBlockedCorrectionStatus;
}

/**
 * جملة قائمة التصحيحات الموقوفة: شاشة التصحيحات الموقوفة في شاشات خطط العمولة بتستهلكها (FR-049).
 * الإسقاط هوية التوقف بس — مفيش مبلغ ولا اسم — والترتيب والصفحة مخدومين بفهرس
 * commission_blocked_corrections_list_idx (الشركة، النشاط، وقت الحفظ، المعرّف).
 */
export function commissionBlockedCorrectionsStatement(
  scope: CommissionBlockedCorrectionListScope,
  cursor: CommissionBlockedCorrectionCursorPosition | null,
  limit: number,
) {
  return sql`SELECT id,employee_id,source_period,code,target_period,
    to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
    to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_us,
    to_char(resolved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS resolved_at
    FROM commission_blocked_corrections
    WHERE company_id = ${scope.companyId} AND business_id = ${scope.businessId}
      ${statusClause(scope.status)} ${cursorClause(cursor)}
    ORDER BY commission_blocked_corrections.created_at DESC,
      commission_blocked_corrections.id DESC LIMIT ${limit + 1}`;
}

function itemOf(row: BlockedCorrectionRow): CommissionBlockedCorrection {
  return commissionBlockedCorrection.parse({
    id: row.id,
    employee_id: row.employee_id,
    source_period: row.source_period,
    code: row.code,
    target_period: row.target_period,
    created_at: row.created_at,
    resolved_at: row.resolved_at,
  });
}

/**
 * يقرأ صفحة التصحيحات الموقوفة: فك المؤشر مربوط بالشركة والنشاط والفلتر، ثم القراءة على
 * المعاملة نفسها، والصف بيتحقق بالسكيما قبل ما يخرج. المؤشر بيتولد من موضع آخر صف الخام
 * بالميكروثانية، فنفس لحظة الحفظ ما بتخليش الصفحات تتكرر ولا تنقص.
 */
export async function listCommissionBlockedCorrections(
  tx: Tx,
  scope: { readonly companyId: string; readonly businessId: string },
  query: CommissionBlockedCorrectionListQuery,
): Promise<CommissionBlockedCorrectionList> {
  const context = {
    companyId: scope.companyId,
    businessId: scope.businessId,
    status: query.status,
  };
  const decoded = decodeCommissionBlockedCorrectionCursor(query.cursor, context);
  if (decoded.kind === 'invalid')
    throw new CommissionBlockedCorrectionReadError('VALIDATION_FAILED');
  const rows = await tx.execute<BlockedCorrectionRow>(
    commissionBlockedCorrectionsStatement(
      { companyId: scope.companyId, businessId: scope.businessId, status: query.status },
      decoded.kind === 'valid' ? decoded.position : null,
      query.limit,
    ),
  );
  const page = rows.slice(0, query.limit);
  const items = page.map(itemOf);
  const last = page.at(-1);
  const next_cursor =
    rows.length > query.limit && last !== undefined
      ? encodeCommissionBlockedCorrectionCursor(context, {
          createdAt: last.created_at_us,
          id: last.id,
        })
      : null;
  return commissionBlockedCorrectionList.parse({ items, next_cursor });
}

/**
 * مصنع عدّاد التصحيحات الموقوفة: قرار الحارس العام (الجلسة والعضوية والصلاحية على الطلب)
 * بييجي قبل استدعاء العدّاد ده بمعاملاته الخاصة؛ المعاملة الواحدة هنا هي معاملة قراءة
 * المستأجر اللي بتعيد فحص الصلاحية والميزة fresh وتقرأ البيانات مع بعض — نفس نمط القائمتين
 * الشقيقتين، من غير معاملة متداخلة ولا تانية جوه المعاملة دي.
 *
 * المعاملة لقطة واحدة (REPEATABLE READ, READ ONLY): إعادة فحص الصلاحية والصفحة بتقرؤا
 * نفس اللحظة بالظبط، فتغيير متزامن بعد إعادة الفحص (سحب صلاحية، إيقاف ميزة، صف تصحيح
 * جديد) ما بيختلطش بالصفحة اللي جاية ولا بيفسّر نفسه برفض. الطلب اللي بعد التغيير
 * بياخد المعاملة الجديدة في refused من جديد.
 *
 * @param database واجهات الداتابيز اللي بتفتح معاملة المستأجر
 * @param reads    قارئ الصلاحية المربوط في جذر التطبيق
 * @returns دالة بتقرأ صفحة التصحيحات الموقوفة
 */
export function createCommissionBlockedCorrectionList(
  database: TenantWrappers,
  reads: CommissionBlockedCorrectionListReads,
): CommissionBlockedCorrectionListRunner {
  return async (actor, businessId, query) =>
    database.withTenant(
      actor.companyId,
      async (tx) => {
        const refused = await reads.access(tx, actor.companyId, actor.userId, businessId);
        if (refused !== null) throw new CommissionBlockedCorrectionReadError(refused);
        return listCommissionBlockedCorrections(
          tx,
          { companyId: actor.companyId, businessId },
          query,
        );
      },
      { userId: actor.userId, readOnly: true },
    );
}
