import { staffAccessState, type StaffAccessState } from '@pospay/contracts';
import type { Tx } from '@pospay/db';

export const EMPLOYEE_ACCESS_STATE_READS = Symbol('EMPLOYEE_ACCESS_STATE_READS');

/** سجل دخول الموظفة كما يصل من قارئ الحالة — بلا هاتف كامل ولا بريد ولا hash. */
export interface EmployeeAccessRecordRow {
  readonly id: string;
  readonly state: 'PENDING' | 'ACTIVE' | 'STOPPED' | 'PHONE_CHANGING';
  readonly roleCode: 'staff' | 'reception';
  readonly branchId: string;
  readonly operationId: string;
  readonly userId: string | null;
  readonly membershipId: string | null;
}

/** صف الحالة: فرع الموظفة الأساسي ومستخدمها المرتبط وسجل الدخول إن وُجد. */
export interface EmployeeAccessStateRow {
  readonly branchId: string;
  readonly linkedUserId: string | null;
  readonly record: EmployeeAccessRecordRow | null;
}

/**
 * قراءات شاشة دخول الموظفة (GET): الحالة من جدول السجل، والسلطة على الفرع الأساسي، وحساب الدخول
 * بآخر ثلاثة أرقام — الواجهة جنب الاستعلام والتنفيذ في persistence.
 */
export interface EmployeeAccessStateReads {
  /**
   * يقرأ حالة الموظفة داخل معاملة القراءة؛ null لموظفة محذوفة أو غريبة عن النشاط.
   *
   * @param tx    معاملة القراءة داخل الشركة
   * @param input الشركة والنشاط والموظفة
   */
  state(
    tx: Tx,
    input: { companyId: string; businessId: string; employeeId: string },
  ): Promise<EmployeeAccessStateRow | null>;
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
}

/**
 * شاشة لوحة الموظفين (GET staff-access): إسقاط صريح للحالة والدور والفرع وآخر ثلاثة أرقام
 * وصلاحية الإعطاء. رابط موظفة بمستخدم بلا سجل دخول يعني مستخدم لوحة عادي فالإعطاء ممنوع.
 *
 * @param tx      معاملة القراءة داخل الشركة
 * @param context الشركة والنشاط والموظفة والقارئ من الجلسة
 * @param reads   القراءات المحقونة
 * @returns حالة الدخول، أو null لموظفة غير موجودة
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
  if (row === null) return null;
  const authority = await reads.authority(tx, {
    companyId: context.companyId,
    actorUserId: context.actorUserId,
    businessId: context.businessId,
    branchId: row.branchId,
  });
  const record = row.record;
  const staffUser =
    record?.userId !== null && record !== null
      ? await reads.staffUser(record.operationId)
      : null;
  return staffAccessState.parse({
    state: record === null ? 'NONE' : record.state === 'PHONE_CHANGING' ? 'PENDING' : record.state,
    role: record?.roleCode ?? null,
    branch_id: record?.branchId ?? null,
    phone_last3: record?.userId != null ? (staffUser?.phoneLast3 ?? null) : null,
    can_manage:
      record === null && row.linkedUserId !== null
        ? false
        : authority && (record === null || record.state !== 'ACTIVE'),
  });
}
