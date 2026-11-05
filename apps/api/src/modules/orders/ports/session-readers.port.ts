import type { SessionAccess } from '../domain/session-authority.ts';
import type { SalePackageType } from '../domain/package-sale-types.ts';
import type { SessionEmployee, SessionLimit, SessionRecord, SessionService } from '../domain/session-types.ts';

/** قراءات محدودة على نفس معاملة المسجلة، بدون تسريب نوع المعاملة إلى الداخل. */
export interface CatalogReaderPort {
  /**
   * يثبت الخدمات بترتيب UUID حتى لا تتغير لقطة المال أثناء الحفظ.
   *
   * @param serviceIds هويات خدمات الطلب لتثبيت سعرها وقواعدها قبل قراءة لقطات المال
   * @returns يكتمل تثبيت الخدمات حتى نهاية المعاملة لمنع تعديل اللقطة أثناء الحفظ
   */
  lock(serviceIds: readonly string[]): Promise<void>;
  /**
   * يعيد لقطات النشاط بعد انتهاء الانتظار، لا أسعار المرحلة الثانية.
   *
   * @param serviceIds هويات الخدمات المطلوبة في النشاط الحالي للتحقق من كل بند
   * @returns أسعار القائمة والأسماء وقواعد العمولة والمشاركة في العتبات والنسخ بعد انتظار الأقفال
   */
  read(serviceIds: readonly string[]): Promise<SessionService[]>;
  /**
   * يقفل نوع الباقة FOR SHARE ثم خدمات مكوناتها FOR SHARE بترتيب الهوية، ويقرأ الكل بعد الأقفال حتى لا يتباع تعريف أو سعر غير اللي اتعرض.
   *
   * @param packageTypeId نوع الباقة المطلوب بيعه في النشاط الحالي
   * @returns التعريف ومكوناته مع لقطة كل خدمة بعد الأقفال، أو null لو النوع مش في النشاط
   */
  readPackageTypeForSale(packageTypeId: string): Promise<SalePackageType | null>;
}
/** العملاء يخفون الهاتف قبل دخوله إلى orders. */
export interface CustomerLookupPort {
  /**
   * يثبت وجود العميلة في الشركة ويعيد الاسم والهاتف المقنّع فقط.
   *
   * @param customerId هوية العميلة التي ستنسب إليها الزيارة داخل الشركة الحالية
   * @returns هوية العميلة واسمها وهاتفها المقنع للحفظ الآمن، أو null إذا لم توجد في الشركة
   */
  read(customerId: string): Promise<SessionRecord['customer'] | null>;
}
/** أهلية الفرع ويوم الحضور مسؤولية staff، لا حسابات orders. */
export interface PerformerCheckPort {
  /**
   * يثبت الموظفات تحت أقفال الموارد البشرية بترتيب UUID.
   *
   * @param employeeIds هويات الموظفات المشاركات لتثبيت الأهلية وروابط المستخدمين أثناء الكتابة
   * @returns يكتمل حيازة أقفال الموارد البشرية حتى لا تتغير حقائق الأداء قبل الحفظ
   */
  lock(employeeIds: readonly string[]): Promise<void>;
  /**
   * يعيد الأهلية والتحذيرات والرابط الفعلي عند وقت الزيارة الأصلي.
   *
   * @param employeeIds هويات الموظفات المدخلات للتحقق من أهلية الفرع ومنع تسجيل الأداء الذاتي
   * @param occurredAt وقت التنفيذ الأصلي لتقييم الأهلية والحضور والإجازة حتى عند الإضافة المتأخرة
   * @returns أهلية الموظفات وأسماءهن وروابط المستخدمين وتحذيرات الحضور والإجازة دون بيانات خاصة
   */
  read(employeeIds: readonly string[], occurredAt: Date): Promise<SessionEmployee[]>;
}
/** settings وحده يحل مصدر الحد وصفة المالك. */
export interface DiscountLimitPort {
  /**
   * يعيد الحد مرة واحدة بعد جميع أقفال المال أو يرفض العضوية غير المتاحة.
   *
   * @param membershipId عضوية المسجلة المختارة لتطبيق حدها الشخصي على المقبول الجديد
   * @returns حد الخصم الفعلي ومصدره لتمييز المالك والصفر الصريح والحد غير المضبوط
   */
  read(membershipId: string): Promise<SessionLimit>;
}
/** التحقق من المكان يمنع تطابق فرع مع نشاط آخر حتى داخل الشركة. */
export interface SessionPlacePort {
  /**
   * يعيد منطقة النشاط إذا كان الفرع النشط تابعاً له داخل الشركة.
   *
   * @returns منطقة النشاط، أو null إن لم يكن الفرع نشطاً تحت هذا النشاط
   */
  read(): Promise<{ timezone: string } | null>;
  /**
   * يعيد توقيت الفرع الفعلي: توقيت الفرع لو له منطقة خاصة، وإلا توقيت النشاط.
   * القاعدة: يُقرأ وحده عند وجود مسودة باقة، فالزيارة المدفوعة ما تدفعش استعلاماً ما تحتاجهوش.
   *
   * @returns توقيت الفرع الفعلي، أو null إن لم يكن الفرع نشطاً تحت هذا النشاط
   */
  branchTimezone(): Promise<string | null>;
}
/** RBAC يعاد قبل replay وبعد الانتظار ولا يثق بانتقاء العميل. */
export interface SessionRecordAccessPort {
  /** يثبت الشركة ثم العضويات بأقفال SHARE المتوافقة مع الكتالوج. */
  lock(): Promise<void>;
  /**
   * يعيد عضويات المستخدم الحالي وإذنه والمنع والميزة عند الوقت المحقون.
   *
   * @param at اللحظة المحقونة الحالية لإعادة تقييم صلاحية العضويات والمنع والميزة بعد الانتظار أو عند replay
   * @returns سلطة التسجيل والمنع والميزة والعضويات المتاحة في الفرع للتحقق من اختيار المسجلة
   */
  read(at: Date): Promise<SessionAccess>;
}
