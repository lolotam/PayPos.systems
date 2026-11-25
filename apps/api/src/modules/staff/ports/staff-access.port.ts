import type { StaffAccessRecordRow } from '../domain/staff-access.ts';
import type {
  StaffAccessActor,
  StaffAccessEmployeeRow,
  StaffAccessIds,
} from './staff-access-begin.port.ts';

export * from './staff-access-begin.port.ts';
export * from './staff-access-commit.port.ts';
export * from './staff-access-cancel.port.ts';
export * from './staff-access-user-steps.port.ts';
export * from './staff-access-phone.port.ts';
export * from './staff-access-stop.port.ts';

/** طلب إعادة ضبط الرقم السري بعد التحقق من العقد: الموظفة والرقم السري الجديد. */
export interface ResetEmployeeStaffPinCommand extends StaffAccessActor {
  /** نشاط الموظفة من المسار. */
  readonly businessId: string;
  /** الموظفة من المسار. */
  readonly employeeId: string;
  /** الرقم السري الجديد كما كتبه المانح. */
  readonly pin: string;
}

/**
 * نطاق إعادة الضبط داخل معاملة الشركة: قفل الشركة ثم الموظفة ثم السجل، وفحص السلطة على
 * الفرع الأساسي، ثم حفظ الرقم المؤقت والتدقيق والحدث — كله في معاملة واحدة.
 */
export interface ResetEmployeeStaffPinScope {
  /** يقفل الشركة النشطة أولاً بترتيب أقفال الكتابة الموحد (P1-3)؛ false لشركة محذوفة. */
  lockCompany(): Promise<boolean>;
  /**
   * يقفل صف الموظفة وسجل دخولها بترتيب الأقفال الموحد (employee ثم record) ويرجعهما؛
   * null لموظفة أو سجل غير موجود.
   */
  lock(): Promise<{
    employee: StaffAccessEmployeeRow | null;
    record: StaffAccessRecordRow | null;
  }>;
  /**
   * يفحص `manage:staff-access:branch` على فرع الموظفة الأساسي جوه نفس المعاملة (FR-F1-3).
   *
   * @param businessId النشاط
   * @param branchId   الفرع الأساسي المقفول
   */
  authority(businessId: string, branchId: string): Promise<boolean>;
  /**
   * يحفظ الرقم السري كرقم مؤقت ينتهي بعد 24 ساعة ويسجل التدقيق بلا أي رقم ظاهر.
   *
   * @param userId  صاحب الرقم
   * @param pinHash الـ hash الجاهز من packages/auth
   */
  saveTemporaryPin(userId: string, pinHash: string): Promise<void>;
  /**
   * يكتب حدث StaffPinSetByOther في الـ outbox جوه نفس المعاملة — بلا رقم سري في الحمولة.
   *
   * @param payload معرّفات الحدث من السجل المقفول
   * @param payload.employeeId الموظفة
   * @param payload.userId المستخدم
   * @param payload.branchId الفرع
   */
  appendEvent(payload: {
    employeeId: string;
    userId: string;
    branchId: string;
  }): Promise<void>;
}

/**
 * خطوة إعادة الضبط: معاملة واحدة على pospay_app تفتحها وتشغّل الشغل جواها — أي رفض
 * يرجّع كل ما كُتب فيها.
 */
export interface ResetEmployeeStaffPinSteps {
  /**
   * يفتح معاملة إعادة الضبط ويشغّل الشغل داخلها.
   *
   * @param actor الشركة والمانح
   * @param input نطاق الخطوة
   * @param input.businessId النشاط
   * @param input.employeeId الموظفة
   * @param input.ids مولّد المعرّفات
   * @param input.at لحظة الساعة المحقونة
   * @param work الشغل داخل المعاملة
   */
  run<T>(
    actor: StaffAccessActor,
    input: { businessId: string; employeeId: string; ids: StaffAccessIds; at: Date },
    work: (scope: ResetEmployeeStaffPinScope) => Promise<T>,
  ): Promise<T>;
}
