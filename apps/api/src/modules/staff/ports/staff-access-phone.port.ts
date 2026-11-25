import type { StaffAccessRecordRow } from '../domain/staff-access.ts';
import type {
  StaffAccessActor,
  StaffAccessEmployeeRow,
  StaffAccessIds,
} from './staff-access-begin.port.ts';

/** طلب تغيير هاتف موظفة بعد التحقق من العقد: الموظفة والهاتف الجديد المُقَرّ والرقم السري المؤقت الجديد. */
export interface ChangeEmployeeStaffPhoneCommand extends StaffAccessActor {
  /** نشاط الموظفة من المسار. */
  readonly businessId: string;
  /** الموظفة من المسار. */
  readonly employeeId: string;
  /** الهاتف الكانوني الجديد المُقَرّ من المانح. */
  readonly phone: string;
  /** الرقم السري المؤقت الجديد كما كتبه المانح. */
  readonly pin: string;
}

/** ناتج الخطوة الأولى: مرجع الاستئناف الكامل لباقي الخطوات بلا قراءة تالية. */
export interface ChangeStaffPhoneBegin {
  /** سجل الدخول المقفول. */
  readonly recordId: string;
  /** معرّف العملية المكتوب على حساب الموظفة في auth. */
  readonly operationId: string;
  /** حساب الموظفة. */
  readonly userId: string;
  /** العضوية التي يُبطَل كاشها بعد الالتزام. */
  readonly membershipId: string;
  /** الدور المحفوظ على السجل. */
  readonly role: StaffAccessRecordRow['roleCode'];
  /** الفرع المحفوظ على السجل. */
  readonly branchId: string;
  /** هوية محاولة التغيير — تثبت أن الخطوة الثالثة تكمل المحاولة نفسها لا أحدث منها. */
  readonly attemptId: string;
  /** بصمة الهاتف الجديد المكتوبة على السجل. */
  readonly phoneHash: string;
}

/** ناتج الخطوة الثالثة: الدور والفرع من السجل المقفول لبناء الرد بلا قراءة بعد الالتزام. */
export interface ChangeStaffPhoneResult {
  /** `changed` تغيير أُنجز الآن، و`already` محاولة مطابقة أنجزها طلب متزامن. */
  readonly kind: 'changed' | 'already';
  /** دور السجل. */
  readonly role: StaffAccessRecordRow['roleCode'];
  /** فرع السجل. */
  readonly branchId: string;
  /** آخر ثلاثة أرقام من الهاتف الجديد للرد. */
  readonly phoneLast3: string;
}

/**
 * نطاق المعاملتين على pospay_app: قفل الشركة ثم الموظفة ثم السجل بترتيب الأقفال الموحد، وفحص السلطة
 * على الفرع الأساسي، ثم كتابة بداية التغيير أو إتمامه — كل خطوة في معاملتها.
 */
export interface ChangeEmployeeStaffPhoneScope {
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
   * بصمة الهاتف المفتاحية نفسها المستخدمة في المنح — المقارنة عند الاستئناف بلا كشف الهاتف.
   *
   * @param phone الهاتف الكانوني
   */
  phoneHash(phone: string): string;
  /**
   * يبدأ التغيير: يمسح الرقم السري وأدلة تغييره، وينقل السجل إلى PHONE_CHANGING ببصمة الهاتف الجديد
   * ومحاولة جديدة (أو يحتفظ بمحاولة الاستئناف المطابقة)، ويكتب التدقيق. يرجع معرّف المحاولة.
   *
   * @param input السجل والمستخدم وبصمة الهاتف الجديد
   * @param input.recordId      سجل الدخول المقفول
   * @param input.userId        حساب الموظفة
   * @param input.phoneHash     بصمة الهاتف الجديد
   * @param input.resumeAttempt محاولة PHONE_CHANGING المطابقة لتُستأنف بدل بدء جديدة، أو null
   */
  startChange(input: {
    recordId: string;
    userId: string;
    phoneHash: string;
    resumeAttempt: string | null;
  }): Promise<string>;
  /**
   * يُتمّ التغيير: يحفظ الرقم المؤقت الجديد ويعيد السجل إلى ACTIVE ويكتب التدقيق.
   *
   * @param input السجل والمستخدم والبصمة الجاهزة للرقم السري
   * @param input.recordId السجل المقفول
   * @param input.userId   حساب الموظفة
   * @param input.pinHash  الـ hash الجاهز من packages/auth
   */
  completeChange(input: { recordId: string; userId: string; pinHash: string }): Promise<void>;
  /**
   * يكتب حدث StaffPinSetByOther في الـ outbox جوه نفس المعاملة — بلا رقم سري ولا هاتف في الحمولة.
   *
   * @param payload معرّفات الحدث من السجل المقفول
   * @param payload.employeeId الموظفة
   * @param payload.userId     المستخدم
   * @param payload.branchId   الفرع
   */
  appendEvent(payload: { employeeId: string; userId: string; branchId: string }): Promise<void>;
}

/** معاملة التغيير على pospay_app: تفتحها وتشغّل الشغل جواها — أي رفض يرجّع كل ما كُتب فيها. */
export interface ChangeEmployeeStaffPhoneSteps {
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
    work: (scope: ChangeEmployeeStaffPhoneScope) => Promise<T>,
  ): Promise<T>;
}

/** مدخل الخطوة الثانية على pospay_auth كما يأتي من use case الموظفين. */
export interface StaffAccessPhoneChangeRequest {
  /** معرّف العملية من سجل الدخول. */
  readonly operationId: string;
  /** الشركة. */
  readonly companyId: string;
  /** حساب الموظفة. */
  readonly userId: string;
  /** الهاتف الكانوني الجديد. */
  readonly phone: string;
  /** المانح المؤكِّد للهاتف. */
  readonly actorUserId: string;
  /** معرّف محاولة التغيير الحالية. */
  readonly attemptId: string;
  /** مولّد UUID v7. */
  readonly ids: StaffAccessIds;
}

/** الجسر الوحيد بين staff وpackages/auth لتغيير الهاتف مع تصوير الرقم السري خارج المعاملات. */
export interface StaffAccessPhoneUserSteps {
  /**
   * يغيّر هاتف حساب الموظفة وينهي جلساتها (الخطوة الثانية)، ويرفض هاتفاً مملوكاً لمستخدم آخر
   * بـ STAFF_ACCESS_PHONE_TAKEN.
   *
   * @param input الحساب والعملية والشركة والهاتف الجديد والمحاولة
   */
  changePhone(input: StaffAccessPhoneChangeRequest): Promise<void>;
  /**
   * يصوّر الرقم السري قبل خطوة الكتابة — الـ hashing بطيء مقصود فلا يُنتظر داخل قفل صف.
   *
   * @param pin الرقم السري كما كُتب
   */
  hash(pin: string): Promise<string>;
}
