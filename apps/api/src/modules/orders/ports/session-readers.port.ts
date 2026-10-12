import type { SessionAccess } from '../domain/session-authority.ts';
import type { SessionEmployee, SessionLimit, SessionRecord, SessionService } from '../domain/session-types.ts';

/** قراءات محدودة على نفس معاملة المسجلة، بدون تسريب نوع المعاملة إلى الداخل. */
export interface CatalogReaderPort {
  /**
   * يثبت الخدمات بترتيب UUID حتى لا تتغير لقطة المال أثناء الحفظ.
   *
   * @param serviceIds بيانات متحقق منها يحتاجها المستهلك
   * @returns نتيجة القراءة أو اكتمال الأثر داخل نفس المعاملة
   */
  lock(serviceIds: readonly string[]): Promise<void>;
  /**
   * يعيد لقطات النشاط بعد انتهاء الانتظار، لا أسعار المرحلة الثانية.
   *
   * @param serviceIds بيانات متحقق منها يحتاجها المستهلك
   * @returns نتيجة القراءة أو اكتمال الأثر داخل نفس المعاملة
   */
  read(serviceIds: readonly string[]): Promise<SessionService[]>;
}
/** العملاء يخفون الهاتف قبل دخوله إلى orders. */
export interface CustomerLookupPort {
  /**
   * يثبت وجود العميلة في الشركة ويعيد الاسم والهاتف المقنّع فقط.
   *
   * @param customerId بيانات متحقق منها يحتاجها المستهلك
   * @returns نتيجة القراءة أو اكتمال الأثر داخل نفس المعاملة
   */
  read(customerId: string): Promise<SessionRecord['customer'] | null>;
}
/** أهلية الفرع ويوم الحضور مسؤولية staff، لا حسابات orders. */
export interface PerformerCheckPort {
  /**
   * يثبت الموظفات تحت أقفال الموارد البشرية بترتيب UUID.
   *
   * @param employeeIds بيانات متحقق منها يحتاجها المستهلك
   * @returns نتيجة القراءة أو اكتمال الأثر داخل نفس المعاملة
   */
  lock(employeeIds: readonly string[]): Promise<void>;
  /**
   * يعيد الأهلية والتحذيرات والرابط الفعلي عند وقت الزيارة الأصلي.
   *
   * @param employeeIds بيانات متحقق منها يحتاجها المستهلك
   * @param occurredAt بيانات متحقق منها يحتاجها المستهلك
   * @returns نتيجة القراءة أو اكتمال الأثر داخل نفس المعاملة
   */
  read(employeeIds: readonly string[], occurredAt: Date): Promise<SessionEmployee[]>;
}
/** settings وحده يحل مصدر الحد وصفة المالك. */
export interface DiscountLimitPort {
  /**
   * يعيد الحد مرة واحدة بعد جميع أقفال المال أو يرفض العضوية غير المتاحة.
   *
   * @param membershipId بيانات متحقق منها يحتاجها المستهلك
   * @returns نتيجة القراءة أو اكتمال الأثر داخل نفس المعاملة
   */
  read(membershipId: string): Promise<SessionLimit>;
}
/** التحقق من المكان يمنع تطابق فرع مع نشاط آخر حتى داخل الشركة. */
export interface SessionPlacePort {
  /** يعيد منطقة النشاط إذا كان الفرع النشط تابعاً له داخل الشركة. */
  read(): Promise<{ timezone: string } | null>;
}
/** RBAC يعاد قبل replay وبعد الانتظار ولا يثق بانتقاء العميل. */
export interface SessionRecordAccessPort {
  /** يثبت الشركة ثم العضويات بأقفال SHARE المتوافقة مع الكتالوج. */
  lock(): Promise<void>;
  /**
   * يعيد عضويات المستخدم الحالي وإذنه والمنع والميزة عند الوقت المحقون.
   *
   * @param at بيانات متحقق منها يحتاجها المستهلك
   * @returns نتيجة القراءة أو اكتمال الأثر داخل نفس المعاملة
   */
  read(at: Date): Promise<SessionAccess>;
}
