import {
  commissionPlanEmployeeList,
  type CommissionPlanEmployeeList,
  type CommissionPlanEmployeeListItem,
  type CommissionPlanEmployeeListQuery,
} from '@pospay/contracts';
import type { TenantWrappers, Tx } from '@pospay/db';

import {
  decodeCommissionPlanEmployeeCursor,
  encodeCommissionPlanEmployeeCursor,
  type CommissionPlanEmployeeCursorContext,
} from './commission-plan-employee-cursor.ts';

/** توكن المزود: المصنع اللي بيرجّع قائمة موظفي الخطط على معاملة القارئ نفسها. */
export const COMMISSION_PLAN_EMPLOYEE_LIST = Symbol('COMMISSION_PLAN_EMPLOYEE_LIST');

/** صف الموظفة في قائمة الخطط: المعرّف والاسمان والرقم الوظيفي بس. */
export type CommissionPlanEmployeeRow = {
  readonly id: string;
  readonly name_ar: string | null;
  readonly name_en: string;
  readonly employee_number: number;
};

/** قراءات قائمة موظفي الخطط: إعادة فحص الوصول وتوقيت النشاط وأسماء الموظفين. */
export interface CommissionPlanEmployeeListReads {
  /** بيعيد فحص الصلاحية والميزة على معاملة القائمة قبل قراءة أي موظف. */
  access(
    companyId: string,
    userId: string,
    businessId: string,
  ): Promise<'FORBIDDEN' | 'FEATURE_DISABLED' | null>;
  /** بيرجّع توقيت النشاط نفسه، عشان تاريخ بدء الخطة يبان بيوم النشاط. */
  timeZone(companyId: string, businessId: string): Promise<string | null>;
  /** بيجيب صفحة أسماء الموظفين: الاسم والرقم الوظيفي بس، مرتبة بالترتيب المخزّن. */
  employeeNames(
    companyId: string,
    businessId: string,
    afterId: string | null,
    limit: number,
  ): Promise<readonly CommissionPlanEmployeeRow[]>;
}

/** مزودو القراءات: دوال جذر التطبيق بتاخد المعاملة نفسها، عشان القراءة كلها transaction واحدة. */
export interface CommissionPlanEmployeeListReadProviders {
  readonly access: (
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
  ) => Promise<'FORBIDDEN' | 'FEATURE_DISABLED' | null>;
  readonly timeZone: (tx: Tx, companyId: string, businessId: string) => Promise<string | null>;
  readonly employeeNames: (
    tx: Tx,
    companyId: string,
    businessId: string,
    afterId: string | null,
    limit: number,
  ) => Promise<readonly CommissionPlanEmployeeRow[]>;
}

export type CommissionPlanEmployeeReadCode = 'VALIDATION_FAILED' | 'FORBIDDEN' | 'FEATURE_DISABLED';

/** رفضات القراءة: خطأ معروف بيتحول لخطأ API معروف، من غير أي بيانات جوه. */
export class CommissionPlanEmployeeReadError extends Error {
  readonly code: CommissionPlanEmployeeReadCode;

  constructor(code: CommissionPlanEmployeeReadCode) {
    super(code);
    this.name = 'CommissionPlanEmployeeReadError';
    this.code = code;
  }
}

/** عدّاد قائمة موظفي الخطط: اللي بتستهلكه شاشة بناء الخطة في الأدمن (48-3). */
export type CommissionPlanEmployeeListRunner = (
  actor: { readonly companyId: string; readonly userId: string },
  businessId: string,
  query: CommissionPlanEmployeeListQuery,
) => Promise<CommissionPlanEmployeeList>;

function bindReads(
  providers: CommissionPlanEmployeeListReadProviders,
  tx: Tx,
): CommissionPlanEmployeeListReads {
  return {
    access: (companyId, userId, businessId) => providers.access(tx, companyId, userId, businessId),
    timeZone: (companyId, businessId) => providers.timeZone(tx, companyId, businessId),
    employeeNames: (companyId, businessId, afterId, limit) =>
      providers.employeeNames(tx, companyId, businessId, afterId, limit),
  };
}

function itemOf(row: CommissionPlanEmployeeRow): CommissionPlanEmployeeListItem {
  return {
    id: row.id,
    name_ar: row.name_ar,
    name_en: row.name_en,
    employee_number: row.employee_number,
  };
}

/**
 * يقرأ قائمة موظفي النشاط لشاشة بناء الخطة: إعادة فحص الوصول، ثم توقيت النشاط، ثم أسماء
 * الموظفين على نفس معاملة القراءة. الترتيب بييجي من قاعدة البيانات نفسه (name_en_key, id)،
 * فمفيش ترتيب في JavaScript يقدر يخالفه.
 */
export async function listCommissionPlanEmployees(
  reads: CommissionPlanEmployeeListReads,
  scope: { readonly companyId: string; readonly userId: string; readonly businessId: string },
  query: CommissionPlanEmployeeListQuery,
): Promise<CommissionPlanEmployeeList> {
  const refused = await reads.access(scope.companyId, scope.userId, scope.businessId);
  if (refused !== null) throw new CommissionPlanEmployeeReadError(refused);
  const timeZone = await reads.timeZone(scope.companyId, scope.businessId);
  if (timeZone === null) throw new CommissionPlanEmployeeReadError('FORBIDDEN');
  const context: CommissionPlanEmployeeCursorContext = {
    companyId: scope.companyId,
    businessId: scope.businessId,
  };
  const decoded = decodeCommissionPlanEmployeeCursor(query.cursor, context);
  if (decoded.kind === 'invalid') throw new CommissionPlanEmployeeReadError('VALIDATION_FAILED');
  const rows = await reads.employeeNames(
    scope.companyId,
    scope.businessId,
    decoded.kind === 'valid' ? decoded.employeeId : null,
    query.limit,
  );
  const page = rows.slice(0, query.limit);
  const items = page.map(itemOf);
  const last = page.at(-1);
  const next_cursor =
    rows.length > query.limit && last !== undefined
      ? encodeCommissionPlanEmployeeCursor(context, last.id)
      : null;
  return commissionPlanEmployeeList.parse({ time_zone: timeZone, items, next_cursor });
}

/**
 * مصنع عدّاد موظفي الخطط: بيفتح معاملة قراءة واحدة للشركة وبيقرا كل حاجة عليها.
 *
 * @param database  واجهات الداتابيز اللي بتفتح معاملة المستأجر
 * @param providers مزودو القراءات المربوطين في جذر التطبيق
 * @returns دالة بتقرأ صفحة موظفي النشاط
 */
export function createCommissionPlanEmployeeList(
  database: TenantWrappers,
  providers: CommissionPlanEmployeeListReadProviders,
): CommissionPlanEmployeeListRunner {
  return async (actor, businessId, query) =>
    database.withTenant(
      actor.companyId,
      (tx) =>
        listCommissionPlanEmployees(
          bindReads(providers, tx),
          { companyId: actor.companyId, userId: actor.userId, businessId },
          query,
        ),
      { userId: actor.userId },
    );
}
