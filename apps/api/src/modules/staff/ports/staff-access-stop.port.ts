import type { StaffAccessRecordRow } from '../domain/staff-access.ts';
import type {
  StaffAccessActor,
  StaffAccessEmployeeRow,
  StaffAccessIds,
} from './staff-access-begin.port.ts';
import type { StaffAccessSessionsEndInput } from './staff-access-auth.port.ts';

/** طلب إيقاف دخول موظفة بعد التحقق من العقد: الموظفة والمانح من الجلسة بلا جسم. */
export interface StopEmployeeStaffAccessCommand extends StaffAccessActor {
  /** نشاط الموظفة من المسار. */
  readonly businessId: string;
  /** الموظفة من المسار. */
  readonly employeeId: string;
}

/** ناتج الإيقاف: الدور والفرع من السجل المقفول لبناء الرد بلا قراءة بعد الالتزام. */
export interface StopEmployeeStaffAccessResult {
  /** دور السجل المحفوظ. */
  readonly role: StaffAccessRecordRow['roleCode'];
  /** فرع السجل المحفوظ. */
  readonly branchId: string;
}

/**
 * نطاق معاملة «إيقاف الدخول» على pospay_app: قفل الشركة ثم الموظفة ثم السجل بترتيب الأقفال الموحد،
 * وفحص السلطة على الفرع الأساسي، ثم إنهاء العضوية والرقم السري وانتقال السجل — كله في معاملة واحدة.
 */
export interface StopEmployeeStaffAccessScope {
  /** يقفل الشركة النشطة أولاً بترتيب أقفال الكتابة الموحد؛ false لشركة محذوفة. */
  lockCompany(): Promise<boolean>;
  /** يقفل صف الموظفة ثم سجل دخولها ويرجعهما؛ null لغير الموجود. */
  lock(): Promise<{
    employee: StaffAccessEmployeeRow | null;
    record: StaffAccessRecordRow | null;
  }>;
  /**
   * يفحص `manage:staff-access:branch` على فرع الموظفة الأساسي جوه نفس المعاملة.
   *
   * @param businessId النشاط
   * @param branchId   الفرع الأساسي المقفول
   */
  authority(businessId: string, branchId: string): Promise<boolean>;
  /**
   * ينهي العضوية فوراً ويمسح الرقم السري وينقل السجل إلى STOPPED ويكتب التدقيق. `employees.user_id`
   * يبقى كما هو فيعيد «إعطاء الدخول» لاحقاً استخدام نفس الحساب.
   *
   * @param input السجل والحساب والعضوية
   * @param input.recordId     سجل الدخول المقفول
   * @param input.userId       حساب الموظفة
   * @param input.membershipId العضوية المنتهية
   */
  stop(input: { recordId: string; userId: string; membershipId: string }): Promise<void>;
}

/** معاملة الإيقاف على pospay_app: تفتحها وتشغّل الشغل جواها — أي رفض يرجّع كل ما كُتب فيها. */
export interface StopEmployeeStaffAccessSteps {
  /**
   * يفتح معاملة الشركة ويشغّل الشغل داخلها.
   *
   * @param actor الشركة والمانح
   * @param input نطاق الخطوة
   * @param input.businessId النشاط
   * @param input.employeeId الموظفة
   * @param input.ids        مولّد المعرّفات
   * @param input.at         لحظة الساعة المحقونة
   * @param work الشغل داخل المعاملة
   */
  run<T>(
    actor: StaffAccessActor,
    input: { businessId: string; employeeId: string; ids: StaffAccessIds; at: Date },
    work: (scope: StopEmployeeStaffAccessScope) => Promise<T>,
  ): Promise<T>;
}

/** خطوة auth بعد الالتزام: إنهاء جلسات الموظفة STAFF_POS وSTAFF_PERSONAL. */
export interface StaffAccessSessionEnder {
  /**
   * ينهي جلسات حساب الموظفة بمعرّف العملية والشركة.
   *
   * @param input الحساب والشركة ومعرّف العملية
   */
  deleteSessions(input: StaffAccessSessionsEndInput): Promise<void>;
}
