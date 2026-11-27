import type {
  GrantBeginScope,
  StaffAccessActor,
  StaffAccessIds,
  StaffAccessRole,
} from './staff-access-begin.port.ts';

/**
 * أمر تمرير الرقم السري المؤقت لبريد الترحيب عند نجاح «إعطاء الدخول»؛
 * يميّز بين `userId` (المدير المانح للدخول ومستلِم نسخة المدير) و`employeeId` (الموظفة المستلِمة).
 */
export interface StaffWelcomePinCommand {
  /** معرّف الشركة. */
  readonly companyId: string;
  /** معرّف النشاط التجاري. */
  readonly businessId: string;
  /** معرّف الموظفة الممنوحة للدخول والمستلِمة لنسختها من الرقم السري. */
  readonly employeeId: string;
  /** معرّف المدير المانح للدخول ومستلِم نسخة المدير من الرقم السري. */
  readonly userId: string;
  /** الرقم السري المؤقت في الذاكرة فقط قبل الختم. */
  readonly pin: string;
}

/** منفذ تمرير الرقم السري المؤقت لخطوة الترحيب بدون استيراد طبقة الحفظ داخل الـ use case. */
export interface StaffWelcomePinContextPort {
  /**
   * يشغّل عملية المنح ضمن سياق يحفظ الرقم المؤقت لختم بريد الترحيب عند نجاح المنح.
   *
   * @param command بيانات الموظفة والرقم السري المؤقت للمنح الجاري
   * @param work    تنفيذ عملية المنح داخل السياق
   */
  runWithPin<T>(command: StaffWelcomePinCommand, work: () => Promise<T>): Promise<T>;
}

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
    employee: {
      readonly id: string;
      readonly businessId: string;
      readonly primaryBranchId: string;
      readonly userId: string | null;
    } | null;
    record: {
      readonly id: string;
      readonly state: 'PENDING' | 'ACTIVE' | 'STOPPED' | 'PHONE_CHANGING' | 'CANCELLING';
      readonly roleCode: StaffAccessRole;
      readonly branchId: string;
      readonly userId: string | null;
      readonly operationId: string;
      readonly attemptId: string;
      readonly phoneHash: string;
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
   * يفتح عضوية الفرع بدور النظام من جدول identity ويسجل تدقيقها.
   *
   * @param input بيانات العضوية الجديدة من السجل المقفول (P1-4)
   * @param input.operationId معرّف العملية المقفولة
   * @param input.userId المستخدم المستهدف
   * @param input.branchId الفرع الأساسي من السجل
   * @param input.role الدور من السجل
   */
  grantMembership(input: {
    operationId: string;
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
    actor: StaffAccessActor,
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
    actor: StaffAccessActor,
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
