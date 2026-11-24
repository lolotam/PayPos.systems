import { StaffPhoneTakenError } from '@pospay/db';
import type { IdGenerator } from '@pospay/db';

/** طلب إنشاء مستخدم الموظفة كما يأتي من use case الموظفين (P1-2: حالة السجل مسرّبة من الخطوة 1). */
export interface StaffAccessProvisionRequest {
  /** معرّف العملية من السجل. */
  readonly operationId: string;
  /** الشركة. */
  readonly companyId: string;
  /** المانح المؤكِّد للهاتف. */
  readonly actorUserId: string;
  /** الهاتف الكانوني. */
  readonly phone: string;
  /** اسم الموظفة. */
  readonly name: string;
  /** مولّد UUID v7. */
  readonly ids: IdGenerator;
  /** حالة السجل المقروءة تحت القفل — الإنشاء لسجل `PENDING` فقط (P1-2). */
  readonly recordState: 'PENDING' | 'STOPPED' | 'CANCELLING';
  /** إعادة تثبيت ربط الهاتف عند استئناف سجل `STOPPED` (P1-4). */
  readonly resetBinding: boolean;
}

/** خطوة المستخدم على pospay_auth مع تصوير الرقم السري — الجسر الوحيد بين staff وpackages/auth. */
export interface StaffAccessUserSteps {
  /**
   * ينشئ مستخدم الموظفة أو يجيده بمعرّف العملية (الخطوة الثانية)، ويرفض هاتفاً مملوكاً لغيره.
   *
   * @param input نطاق الإنشاء
   */
  provision(input: StaffAccessProvisionRequest): Promise<{ userId: string }>;
  /**
   * يصوّر الرقم السري قبل المعاملة الثالثة — الـ hashing بطيء مقصود فلا يُنتظر داخل قفل صف.
   *
   * @param pin الرقم السري كما كُتب
   */
  hash(pin: string): Promise<string>;
  /**
   * يرفض فورًا عند الهاتف المملوك بترجمة موحدة.
   *
   * @param error الخطأ القادم من الخطوة
   * @returns true لو الخطأ رفض هاتف مملوك
   */
  isPhoneTaken(error: unknown): boolean;
}

export { StaffPhoneTakenError };

/**
 * إبطال كاش المنح بعد الالتزام (الخطوة الرابعة بعد commit) — الجلسات القديمة تعرف عضويتها الجديدة.
 */
export interface StaffAccessGrantCache {
  /**
   * يرفع إصدار الكاش للشركة وللعضوية الجديدة.
   *
   * @param input نطاق الإبطال
   * @param input.companyId الشركة
   * @param input.membershipId العضوية الجديدة
   */
  invalidate(input: { companyId: string; membershipId: string }): Promise<void>;
}
