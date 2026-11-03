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

/** صف الموظفة في قائمة الخطط، ومعاه مفتاح الترتيب الخام اللي بيخرج للمؤشر بس. */
export type CommissionPlanEmployeeRow = {
  readonly id: string;
  readonly name_ar: string | null;
  readonly name_en: string;
  readonly employee_number: number;
  readonly name_en_key: string;
};

/** قراءات قائمة موظفي الخطط على معاملة واحدة: الوصول والتوقيت وأسماء الموظفين. */
export interface CommissionPlanEmployeeListReads {
  /** بيعيد فحص الصلاحية والميزة على معاملة القائمة قبل قراءة أي موظف. */
  access(
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
  ): Promise<'FORBIDDEN' | 'FEATURE_DISABLED' | null>;
  /** بيرجّع توقيت النشاط نفسه، عشان تاريخ بدء الخطة يبان بيوم النشاط. */
  timeZone(tx: Tx, companyId: string, businessId: string): Promise<string | null>;
  /** بيجيب صفحة الأسماء والمفتاح الخام للمؤشر، مرتبة بالترتيب المخزّن. */
  employeeNames(
    tx: Tx,
    companyId: string,
    businessId: string,
    after: { readonly key: string; readonly id: string } | null,
    limit: number,
  ): Promise<readonly CommissionPlanEmployeeRow[]>;
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

function itemOf(row: CommissionPlanEmployeeRow): CommissionPlanEmployeeListItem {
  return {
    id: row.id,
    name_ar: row.name_ar,
    name_en: row.name_en,
    employee_number: row.employee_number,
  };
}

/**
 * يقرأ قائمة موظفي النشاط لشاشة بناء الخطة على معاملة واحدة: الوصول، ثم التوقيت، ثم فك
 * المؤشر، ثم الأسماء. الترتيب والموضع بالقيمة من (name_en_key, id)، فمفيش ترتيب في JavaScript
 * ولا قراءة لصف مرساة يقدروا يخالفوا قاعدة البيانات أو يكشفوا حذفه.
 */
export async function listCommissionPlanEmployees(
  reads: CommissionPlanEmployeeListReads,
  tx: Tx,
  scope: { readonly companyId: string; readonly userId: string; readonly businessId: string },
  query: CommissionPlanEmployeeListQuery,
): Promise<CommissionPlanEmployeeList> {
  const refused = await reads.access(tx, scope.companyId, scope.userId, scope.businessId);
  if (refused !== null) throw new CommissionPlanEmployeeReadError(refused);
  const timeZone = await reads.timeZone(tx, scope.companyId, scope.businessId);
  if (timeZone === null) throw new CommissionPlanEmployeeReadError('FORBIDDEN');
  const context: CommissionPlanEmployeeCursorContext = {
    companyId: scope.companyId,
    businessId: scope.businessId,
  };
  const decoded = decodeCommissionPlanEmployeeCursor(query.cursor, context);
  if (decoded.kind === 'invalid') throw new CommissionPlanEmployeeReadError('VALIDATION_FAILED');
  const rows = await reads.employeeNames(
    tx,
    scope.companyId,
    scope.businessId,
    decoded.kind === 'valid' ? decoded.after : null,
    query.limit,
  );
  const page = rows.slice(0, query.limit);
  const items = page.map(itemOf);
  const last = page.at(-1);
  const next_cursor =
    rows.length > query.limit && last !== undefined
      ? encodeCommissionPlanEmployeeCursor(context, { key: last.name_en_key, id: last.id })
      : null;
  return commissionPlanEmployeeList.parse({ time_zone: timeZone, items, next_cursor });
}

/**
 * مصنع عدّاد موظفي الخطط: بيفتح معاملة قراءة واحدة للشركة وبيسلّمها لكل القراءات من غير محوّل.
 *
 * @param database واجهات الداتابيز اللي بتفتح معاملة المستأجر
 * @param reads    قراءات الوصول والتوقيت وأسماء الموظفين المربوطة في جذر التطبيق
 * @returns دالة بتقرأ صفحة موظفي النشاط
 */
export function createCommissionPlanEmployeeList(
  database: TenantWrappers,
  reads: CommissionPlanEmployeeListReads,
): CommissionPlanEmployeeListRunner {
  return async (actor, businessId, query) =>
    database.withTenant(
      actor.companyId,
      (tx) =>
        listCommissionPlanEmployees(
          reads,
          tx,
          { companyId: actor.companyId, userId: actor.userId, businessId },
          query,
        ),
      { userId: actor.userId },
    );
}
