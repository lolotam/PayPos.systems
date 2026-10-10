import type { DeviceLockDecision, DeviceLockStep } from '../domain/passkey-device-lock.ts';

/** محاولة مرفوضة تحفظ بعد انتهاء معاملة الحضور، والمعرف الخام مؤقت داخل الذاكرة. */
export interface AttendanceDeviceRefusalInput {
  companyId: string;
  businessId: string;
  employeeId: string;
  holderEmployeeId: string | null;
  branchId: string | null;
  step: DeviceLockStep;
  reason: Extract<DeviceLockDecision, { kind: 'REFUSE' }>['reason'];
  installationId: string;
  at: Date;
}
/** منفذ مستقل حتى لا يمحو rollback سجل المحاولة المرفوضة. */
export interface AttendanceDeviceRefusals {
  /** يحفظ محاولة واحدة بمعاملة مستقلة؛ يبلغ فشل الكاتب دون تغيير رفض الموظف.
   *
   * @param input هوية المحاولة ووقتها دون بيانات اعتماد
   */
  record(input: AttendanceDeviceRefusalInput): Promise<void>;
}
