import {
  commissionStatementExportStatus,
  type CommissionStatementExportStatus,
  type DocumentRenderErrorCode,
  type DocumentRenderState,
} from '@pospay/contracts';
import type { TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { ApiError } from '../../../shared/errors.ts';

export const STATEMENT_EXPORT_STATUS_QUERY = Symbol('STATEMENT_EXPORT_STATUS_QUERY');

/** هوية الاستعلام: الشركة والمستخدم من الجلسة، والنشاط والشهر من المسار. */
export interface StatementExportStatusScope {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
  readonly period: string;
}

/** قراءات الصلاحية والميزة للاستعلام عن حالة التصدير، مربوطة في جذر التطبيق. */
export interface StatementExportStatusReaders {
  scope(
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
  ): Promise<
    | {
        readonly kind: 'scope';
        readonly scope: { readonly businessWide: boolean; readonly branchIds: readonly string[] };
      }
    | { readonly kind: 'forbidden' }
    | { readonly kind: 'feature_disabled' }
  >;
  featureEnabled(tx: Tx, companyId: string): Promise<boolean>;
}

export type StatementExportStatusQuery = (
  scope: StatementExportStatusScope,
  renderId: string,
) => Promise<CommissionStatementExportStatus>;

/** قارئ حالة المستند من Redis، بنفس شكل قارئ كشف الحضور. */
export interface StatementExportStatusRead {
  /** يقرأ حالة المستند؛ null لما الهاش مش موجود أو حالته مش معروفة. */
  read(
    companyId: string,
    renderId: string,
  ): Promise<{
    state: DocumentRenderState;
    requestedBy: string;
    errorCode: DocumentRenderErrorCode | null;
    bytesPresent: boolean;
  } | null>;
}

/**
 * يفحص صلاحية الطالب (read:commissions:business بنطاقه) وتفعيل ميزة العمولات وصف الطلب نفسه
 * في معاملة قراءة واحدة (P2-1). أي مسار برّه الطالب أو النشاط أو الشهر بيرجع NOT_FOUND موحّدة.
 */
async function readExportAuthorization(
  tx: Tx,
  scope: StatementExportStatusScope,
  renderId: string,
  readers: StatementExportStatusReaders,
): Promise<'FOUND' | 'FORBIDDEN' | 'FEATURE_DISABLED' | 'NOT_FOUND'> {
  const foundScope = await readers.scope(tx, scope.companyId, scope.userId, scope.businessId);
  if (foundScope.kind === 'forbidden') return 'FORBIDDEN';
  if (foundScope.kind === 'feature_disabled') return 'FEATURE_DISABLED';
  if (!(await readers.featureEnabled(tx, scope.companyId))) return 'FEATURE_DISABLED';
  const rows = await tx.execute(sql`SELECT 1 FROM commission_statement_exports
    WHERE company_id = ${scope.companyId} AND company_id = app_company_id()
      AND render_id = ${renderId}::uuid AND business_id = ${scope.businessId}
      AND period = ${scope.period} AND requested_by = ${scope.userId}`);
  return rows.length > 0 ? 'FOUND' : 'NOT_FOUND';
}

/**
 * مصنع استعلام الحالة (شاشة تصدير كشف العمولات): فحص الصلاحية والميزة وصف الطلب في معاملة
 * مستأجر للقراءة فقط، وبعدين هاش Redis؛ أي طلب برّه الطالب أو النشاط أو الشهر نفس الـ 404 (ADR-0049 §1.5).
 *
 * @param database واجهات الداتابيز اللي بتفتح معاملة المستأجر
 * @param status قارئ حالة المستند
 * @param readers قراءات الصلاحية والميزة المربوطة في جذر التطبيق
 * @returns الاستعلام
 */
export function createStatementExportStatusQuery(
  database: Pick<TenantWrappers, 'withTenant'>,
  status: StatementExportStatusRead,
  readers: StatementExportStatusReaders,
): StatementExportStatusQuery {
  return async (scope, renderId) => {
    const decision = await database.withTenant(
      scope.companyId,
      (tx) => readExportAuthorization(tx, scope, renderId, readers),
      { userId: scope.userId, readOnly: true },
    );
    if (decision !== 'FOUND') throw new ApiError(decision);
    const hash = await status.read(scope.companyId, renderId);
    if (hash === null || hash.requestedBy !== scope.userId) throw new ApiError('NOT_FOUND');
    // البايتات اللي راحت قبل ما ينزلها المستخدم بتقرأ منتهية، مش مفقودة (ADR-0049 §1.6).
    const state = hash.state === 'READY' && !hash.bytesPresent ? 'EXPIRED' : hash.state;
    return commissionStatementExportStatus.parse({
      state,
      ...(state === 'FAILED' && hash.errorCode !== null ? { error_code: hash.errorCode } : {}),
    });
  };
}
