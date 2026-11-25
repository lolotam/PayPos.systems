import { staffAccessState, type StaffAccessState } from '@pospay/contracts';
import type { Tx } from '@pospay/db';

export const EMPLOYEE_ACCESS_STATE_READS = Symbol('EMPLOYEE_ACCESS_STATE_READS');

import type { StaffAccessStateRow } from '@pospay/contracts';
export type EmployeeAccessStateRow = StaffAccessStateRow;

/**
 * قراءات شاشة دخول الموظفة (GET): الحالة من جدول السجل، وإذن قراءة الموظفة (P1-1) قبل أي كشف،
 * والسلطة على الفرع الأساسي، وحساب الدخول بآخر ثلاثة أرقام — التنفيذ في persistence بلا أقفال كتابة.
 */
export interface EmployeeAccessStateReads {
  /**
   * يقرأ حالة الموظفة داخل معاملة قراءة بلا أقفال كتابة؛ null لموظفة محذوفة أو غريبة.
   *
   * @param tx    معاملة القراءة داخل الشركة
   * @param input الشركة والنشاط والموظفة
   */
  state(
    tx: Tx,
    input: { companyId: string; businessId: string; employeeId: string },
  ): Promise<EmployeeAccessStateRow | null>;
  /**
   * يفحص إذن قراءة سجل الموظفة (`manage:employees:business` على نشاطها) — بوابة الـ 404 (P1-1).
   *
   * @param tx    معاملة القراءة داخل الشركة
   * @param input الشركة والقارئ والنشاط والفرع
   */
  readAccess(
    tx: Tx,
    input: { companyId: string; actorUserId: string; businessId: string; branchId: string },
  ): Promise<'ALLOWED' | 'DENIED' | 'FEATURE_DISABLED'>;
  /**
   * يفحص `manage:staff-access:branch` على فرع الموظفة الأساسي (FR-F1-3).
   *
   * @param tx    معاملة القراءة داخل الشركة
   * @param input الشركة والقارئ والنشاط والفرع
   */
  authority(
    tx: Tx,
    input: { companyId: string; actorUserId: string; businessId: string; branchId: string },
  ): Promise<boolean>;
  /**
   * يقرأ حساب الدخول بمعرّف العملية لآخر ثلاثة أرقام من الهاتف فقط.
   *
   * @param operationId معرّف العملية
   */
  staffUser(operationId: string): Promise<{ userId: string; phoneLast3: string | null } | null>;
  /**
   * يفحص عضوية المالك السارية في الشركة — صلاحية الإلغاء بعد الـ 24 ساعة (P1-2).
   *
   * @param tx    معاملة القراءة داخل الشركة
   * @param input الشركة والفاعل من الجلسة
   */
  actorIsOwner(tx: Tx, input: { companyId: string; actorUserId: string }): Promise<boolean>;
  /**
   * صلاحية إلغاء السجل المعلّق للفاعل ده: المانح الأصلي أو مالك الشركة، وبعد 24 ساعة من
   * بداية المحاولة (FR-F1-6، P1-2). القاعدة في الـ domain والمُنفّذ في persistence.
   *
   * @param tx    معاملة القراءة داخل الشركة
   * @param input الشركة والفاعل وصف السجل
   */
  cancelAllowed(
    tx: Tx,
    input: { companyId: string; actorUserId: string; record: StaffAccessStateRow['record'] },
  ): Promise<boolean>;
}

/**
 * شاشة لوحة الموظفين (GET staff-access): بوابة قراءة الموظفة أولًا (P1-1) — أي رفض أو غياب يعني
 * 404 بلا كشف السجل ولا الدور ولا أرقام الهاتف — ثم إسقاط الحالة وصلاحية الإعطاء بلا أقفال كتابة.
 *
 * @param tx      معاملة القراءة داخل الشركة
 * @param context الشركة والنشاط والموظفة والقارئ من الجلسة
 * @param reads   القراءات المحقونة
 * @returns حالة الدخول، أو null لموظفة غير موجودة أو ممنوع قراءتها
 */
export async function readEmployeeStaffAccess(
  tx: Tx,
  context: { companyId: string; businessId: string; employeeId: string; actorUserId: string },
  reads: EmployeeAccessStateReads,
): Promise<StaffAccessState | null> {
  const row = await reads.state(tx, {
    companyId: context.companyId,
    businessId: context.businessId,
    employeeId: context.employeeId,
  });
  // الموظفة الغريبة والموظفة الممنوع قراءتها نفس الرد — الـ 404 الموحد قبل أي كشف (FR-F1-5، P1-1).
  if (row === null) return null;
  const access = await reads.readAccess(tx, {
    companyId: context.companyId,
    actorUserId: context.actorUserId,
    businessId: context.businessId,
    branchId: row.branchId,
  });
  if (access !== 'ALLOWED') return null;
  const authority = await reads.authority(tx, {
    companyId: context.companyId,
    actorUserId: context.actorUserId,
    businessId: context.businessId,
    branchId: row.branchId,
  });
  return projectState(tx, row, authority, reads, false, context);
}

/**
 * نتيجة الكتابة المرخّصة (الإلغاء) تُرد تحت إذن المنح؛ هذا لا يفتح GET لمن لا يحق له قراءة ملف
 * الموظفة. الكتابة التزمت فعلاً، فتعذّر قراءة آخر ثلاثة أرقام من auth لا يحوّلها إلى 500.
 */
export async function readGrantedEmployeeStaffAccess(
  tx: Tx,
  context: { companyId: string; businessId: string; employeeId: string; actorUserId: string },
  reads: EmployeeAccessStateReads,
): Promise<StaffAccessState | null> {
  const row = await reads.state(tx, context);
  if (row === null || !(await reads.authority(tx, { ...context, branchId: row.branchId }))) return null;
  return projectState(tx, row, true, reads, true, context);
}

async function projectState(
  tx: Tx,
  row: StaffAccessStateRow,
  authority: boolean,
  reads: EmployeeAccessStateReads,
  committedWrite: boolean,
  context: { companyId: string; actorUserId: string },
) {
  const record = row.record;
  const staffUser =
    record?.userId !== null && record !== null
      ? await reads.staffUser(record.operationId).catch((error: unknown) => {
          if (!committedWrite) throw error;
          return null;
        })
      : null;
  return staffAccessState.parse({
    state:
      record === null ? 'NONE' : record.state === 'CANCELLING' ? 'PENDING' : record.state,
    role: record?.roleCode ?? null,
    branch_id: record?.branchId ?? null,
    phone_last3: record?.userId != null ? (staffUser?.phoneLast3 ?? null) : null,
    // الموظفة ما بتديرش نفسها: ولا الموظفة المرتبطة بمستخدم تاني، ولا موظفة ليها حساب
    // دخول وبلا سجل (المنح نفسه بيرفض الحالة دي). الباقي صلاحية الفرع زي ما هي — حتى على
    // السجل النشط، عشان إعادة الضبط تبقى متاحة لمدير الفرع (F2b).
    can_manage:
      (record === null && row.linkedUserId !== null) ||
      row.linkedUserId === context.actorUserId ||
      record?.userId === context.actorUserId
        ? false
        : authority,
    can_cancel:
      authority && record !== null
        ? await reads.cancelAllowed(tx, {
            companyId: context.companyId,
            actorUserId: context.actorUserId,
            record,
          })
        : false,
  });
}
