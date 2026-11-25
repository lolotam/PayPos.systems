import { OWNER_ROLE_ID, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { evaluateAccess } from '../domain/access.ts';
import { readAccessTransaction } from './access-reader.ts';

import type { StaffAccessStateRow } from '@pospay/contracts';
export type { StaffAccessStateRow } from '@pospay/contracts';

/**
 * سلطة «إعطاء الدخول» على فرع الموظفة الأساسي (FR-F1-3): بتتقري جوه معاملة الكتابة بعد قفل صف
 * الموظفة، فتغيّر الصلاحية أثناء الانتظار ما يقدرش يعدي الفحص — نفس بروتوكول أقفال PR 7.
 *
 * @param tx    معاملة الشركة التي يفتحها المستدعِ
 * @param input الشركة والقارئ والنشاط والفرع الأساسي للموظفة
 * @returns true لو القارئ بيملك `manage:staff-access:branch` على الفرع ده
 */
export async function readStaffAccessAuthority(
  tx: Tx,
  input: { companyId: string; actorUserId: string; businessId: string; branchId: string },
): Promise<boolean> {
  const [time] = await tx.execute<{ at: Date }>(sql`SELECT clock_timestamp() AS at`);
  if (time === undefined) return false;
  const access = await readAccessTransaction(
    tx,
    input.companyId,
    input.actorUserId,
    new Date(time.at),
  );
  return evaluateAccess(access.grants, 'manage:staff-access:branch', {
    companyId: input.companyId,
    businessId: input.businessId,
    branchId: input.branchId,
  });
}

/**
 * حالة دخول موظفة واحدة للقراءة (شاشة لوحة الموظفين): فرعها الأساسي ومستخدمها المرتبط وسجل الدخول
 * إن وُجد. الموظفة المحذوفة أو الغريبة بترجع null عشان المسار يرد EMPLOYEE_NOT_FOUND من غير كشف أي شيء.
 * ومع السجل بتترجع بيانات الإلغاء: المانح الأصلي وبداية المحاولة ولحظة القراءة من ساعة القاعدة.
 *
 * @param tx    معاملة قراءة داخل الشركة
 * @param input الشركة والنشاط والموظفة
 * @returns الفرع الأساسي والربط والسجل، أو null لموظفة غير موجودة
 */
export async function readStaffAccessState(
  tx: Tx,
  input: { companyId: string; businessId: string; employeeId: string },
): Promise<StaffAccessStateRow | null> {
  const [employee] = await tx.execute<{ primary_branch_id: string; user_id: string | null }>(sql`
    SELECT primary_branch_id, user_id FROM employees
    WHERE company_id=${input.companyId} AND business_id=${input.businessId}
      AND id=${input.employeeId} AND deleted_at IS NULL`);
  if (employee === undefined) return null;
  const [record] = await tx.execute<{
    state: 'PENDING' | 'ACTIVE' | 'STOPPED' | 'PHONE_CHANGING' | 'CANCELLING';
    role_code: 'staff' | 'reception';
    branch_id: string;
    operation_id: string;
    user_id: string | null;
  }>(staffAccessRecordQuery(input));
  if (record === undefined) {
    return { branchId: employee.primary_branch_id, linkedUserId: employee.user_id, record: null };
  }
  const meta = await readStaffAccessCancelMeta(tx, input);
  return {
    branchId: employee.primary_branch_id,
    linkedUserId: employee.user_id,
    record: {
      state: record.state,
      roleCode: record.role_code,
      branchId: record.branch_id,
      operationId: record.operation_id,
      userId: record.user_id,
      grantedBy: meta.grantedBy,
      attemptStartedAt: meta.attemptStartedAt,
      now: meta.now,
    },
  };
}

/**
 * بيانات الإلغاء للسجل: المانح الأصلي وبداية المحاولة ولحظة القراءة من ساعة القاعدة. القراية
 * التانية خفيفة وبتاخد القيم من نفس القاعدة، فما فيش فرق ساعة بين البحث والنتيجة. لو السجل
 * ما اتقراش (سباق مع حذف) القيم اللي بترجع تبقى صفر-عمر، فمفيش صلاحية إلغاء.
 *
 * @param tx    معاملة القراءة داخل الشركة
 * @param input الشركة والموظفة
 * @returns المانح وبداية المحاولة ولحظة القراءة
 */
async function readStaffAccessCancelMeta(
  tx: Tx,
  input: { companyId: string; employeeId: string },
): Promise<{ grantedBy: string; attemptStartedAt: Date; now: Date }> {
  const [row] = await tx.execute<{ granted_by: string; attempt_started_at: Date; now: Date }>(sql`
    SELECT granted_by, attempt_started_at, clock_timestamp() AS now
    FROM employee_staff_access
    WHERE company_id=${input.companyId} AND employee_id=${input.employeeId}`);
  const now = row === undefined ? new Date() : new Date(row.now);
  return {
    grantedBy: row?.granted_by ?? '',
    attemptStartedAt: row === undefined ? now : new Date(row.attempt_started_at),
    now,
  };
}

/**
 * هل الفاعل مالك الشركة؟ مالك الشركة يقدر يلغي سجل الانتظار زي المانح الأصلي (P1-2) — العضوية
 * سارية على مستوى الشركة ودورها هو دور المالك النظامي.
 *
 * @param tx    معاملة القراءة داخل الشركة
 * @param input الشركة والفاعل من الجلسة
 * @returns true لو الفاعل مالك الشركة
 */
export async function readStaffAccessOwner(
  tx: Tx,
  input: { companyId: string; actorUserId: string },
): Promise<boolean> {
  const rows = await tx.execute(sql`SELECT 1 FROM memberships
    WHERE company_id=${input.companyId} AND user_id=${input.actorUserId}
      AND role_id=${OWNER_ROLE_ID}::uuid
      AND role_owner_key='global' AND scope_type='COMPANY' AND scope_id=${input.companyId}
      AND starts_at<=clock_timestamp() AND (ends_at IS NULL OR ends_at>clock_timestamp())
    LIMIT 1`);
  return rows.length !== 0;
}

/** نفس استعلام حالة الدخول للشاشة وEXPLAIN؛ الإسقاط محدود ولا يحمل الهاتف أو الـ hash. */
export function staffAccessRecordQuery(input: { companyId: string; employeeId: string }) {
  return sql`SELECT state, role_code, branch_id, operation_id, user_id
    FROM employee_staff_access WHERE company_id=${input.companyId} AND employee_id=${input.employeeId}`;
}
