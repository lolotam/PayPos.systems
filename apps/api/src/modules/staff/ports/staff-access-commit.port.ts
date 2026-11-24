import type { StaffAccessRole } from './staff-access-begin.port.ts';
import type { StaffAccessIds } from './staff-access-begin.port.ts';

/**
 * نطاق الخطوة الثالثة داخل معاملة الشركة: إعادة الفحص تحت القفل ثم العضوية والربط والرقم المؤقت
 * والتدقيق والحدث — كله في معاملة واحدة فلا حالة جزئية أبداً.
 */
export interface GrantCommitScope {
  /** يقفل الشركة النشطة أولاً بترتيب أقفال PR 7؛ false لشركة محذوفة فيوقف الخطوة. */
  lockCompany(): Promise<boolean>;
  /**
   * يعيد قراءة السجل والموظفة تحت القفل لإعادة فحص الخطوة الأولى بعد انتظار الخطوة الثانية.
   */
  recheck(): Promise<{
    employee: { readonly id: string; readonly businessId: string; readonly primaryBranchId: string; readonly userId: string | null } | null;
    record: {
      readonly id: string;
      readonly state: 'PENDING' | 'ACTIVE' | 'STOPPED' | 'PHONE_CHANGING' | 'CANCELLING';
      readonly roleCode: StaffAccessRole;
      readonly branchId: string;
      readonly userId: string | null;
    } | null;
  }>;
  /**
   * نفس فحص السلطة جوه المعاملة الجديدة.
   *
   * @param businessId النشاط
   * @param branchId   الفرع الأساسي
   */
  authority(businessId: string, branchId: string): Promise<boolean>;
  /**
   * يثبت أن المستخدم هو المقروض بمعرّف العملية نفسه وفي نفس الشركة عبر packages/auth (P1-5).
   *
   * @param input بيانات الإثبات
   * @param input.companyId الشركة
   * @param input.userId المستخدم المستهدف
   * @param input.operationId معرّف العملية من السجل المقفول
   */
  assertBinding(input: {
    companyId: string;
    userId: string;
    operationId: string;
  }): Promise<void>;
  /**
   * يفتح عضوية الفرع بدور النظام من جدول identity ويسجل تدقيقها.
   *
   * @param input بيانات العضوية الجديدة من السجل المقفول (P1-4)
   * @param input.userId المستخدم المستهدف
   * @param input.branchId الفرع الأساسي من السجل
   * @param input.role الدور من السجل
   */
  grantMembership(input: {
    userId: string;
    branchId: string;
    role: StaffAccessRole;
  }): Promise<{ membershipId: string }>;
  /**
   * يربط الموظفة بمستخدم الدخول ويرفع revision ويسجل التدقيق (FR-F1-4).
   *
   * @param userId المستخدم الجديد للربط
   */
  linkEmployee(userId: string): Promise<void>;
  /**
   * يحفظ الرقم السري كمؤقت ينتهي بعد 24 ساعة ويسجل التدقيق بلا أي رقم ظاهر.
   *
   * @param userId  صاحب الرقم
   * @param pinHash الـ hash الجاهز من packages/auth
   */
  saveTemporaryPin(userId: string, pinHash: string): Promise<void>;
  /**
   * يحوّل السجل إلى ACTIVE بمعرّفي المستخدم والعضوية (BR-1).
   *
   * @param input معرّفات التفعيل
   * @param input.recordId معرّف السجل
   * @param input.userId المستخدم المؤكد
   * @param input.membershipId العضوية المُنشأة
   */
  markActive(input: { recordId: string; userId: string; membershipId: string }): Promise<void>;
  /**
   * يكتب حدث StaffAccessGranted في الـ outbox جوه نفس المعاملة — بلا هاتف ولا رقم سري في الحمولة.
   *
   * @param payload معرّفات الحدث من السجل المقفول (P1-4)
   * @param payload.employeeId الموظفة
   * @param payload.userId المستخدم
   * @param payload.membershipId العضوية
   * @param payload.branchId الفرع من السجل
   * @param payload.role الدور من السجل
   */
  appendEvent(payload: {
    employeeId: string;
    userId: string;
    membershipId: string;
    branchId: string;
    role: StaffAccessRole;
  }): Promise<void>;
}

/**
 * خطوات إعطاء الدخول: الخطوة الأولى والثالثة كل واحدة معاملة شركة مستقلة، والفاصل بينهم خطوة auth
 * لا يمكن جمعها معهما في معاملة واحدة (FR-F1-6، قرار D6).
 */
export interface GrantEmployeeAccessSteps {
  /**
   * يفتح معاملة الخطوة الأولى بفضل المستخدم ويشغّل الشغل داخلها.
   *
   * @param actor الشركة والمانح
   * @param input نطاق الخطوة
   * @param input.businessId النشاط
   * @param input.employeeId الموظفة
   * @param input.ids مولّد المعرّفات
   * @param input.at لحظة الساعة المحقونة
   * @param work الشغل داخل المعاملة
   */
  begin<T>(
    actor: { companyId: string; userId: string },
    input: { businessId: string; employeeId: string; ids: StaffAccessIds; at: Date },
    work: (scope: GrantBeginScope) => Promise<T>,
  ): Promise<T>;
  /**
   * يفتح معاملة الخطوة الثالثة ويشغّل الشغل داخلها؛ أي رفض يرجّع كل ما كُتب داخلها.
   *
   * @param actor الشركة والمانح
   * @param input نطاق الخطوة
   * @param input.businessId النشاط
   * @param input.employeeId الموظفة
   * @param input.recordId السجل المستأنَف
   * @param input.ids مولّد المعرّفات
   * @param input.at لحظة الساعة المحقونة
   * @param work الشغل داخل المعاملة
   */
  commit<T>(
    actor: { companyId: string; userId: string },
    input: {
      businessId: string;
      employeeId: string;
      recordId: string;
      ids: StaffAccessIds;
      at: Date;
    },
    work: (scope: GrantCommitScope) => Promise<T>,
  ): Promise<T>;
}
