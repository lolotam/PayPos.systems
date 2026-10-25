import type { SessionLine, SessionRecord } from '../domain/session-types.ts';
import type { DiscountConsumptionPort } from './discount-consumption.port.ts';
import type { CatalogReaderPort, CustomerLookupPort, DiscountLimitPort, PerformerCheckPort, SessionPlacePort, SessionRecordAccessPort } from './session-readers.port.ts';

/** الساعة المحقونة تضمن وقتاً جديداً بعد أقفال قد تستغرق انتظاراً. */
export interface Clock { /** يعيد اللحظة الحالية دون اعتماد داخلي على ساعة النظام. */ now(): Date }
/** هويات UUID v7 محقونة حتى يمكن إثبات جميع الآثار في الاختبار. */
export interface IdGenerator { /** ينشئ هوية مستقلة لكل صف وأثر مالي. */ newId(): string }
/** سياق مؤكد من النقل؛ actor لا يأتي من جسم الطلب. */
export interface SessionWriteContext { companyId: string; userId: string; businessId: string; branchId: string; key: string; fingerprint: string; sessionId?: string }
/** الحفظ append-only؛ القفل الاستشاري يغطي مجموعة بنود الزيارة كلها. */
export interface SessionRepository {
  /**
   * يحمل رأس الزيارة وبنودها داخل نطاق النشاط والفرع؛ المجهول يعامل كممنوع.
   *
   * @param sessionId هوية الزيارة المطلوبة للتحقق من وجودها في النشاط والفرع الحاليين
   * @returns رأس الزيارة وكل بنودها لتقييم الإضافة، أو null للهوية غير المتاحة في النطاق
   */
  load(sessionId: string): Promise<SessionRecord | null>;
  /**
   * يسلسل الإضافات قبل العد وتخصيص الترتيب دون UPDATE على رأس الزيارة.
   *
   * @param sessionId هوية الزيارة التي تتنافس طلبات الإضافة على سعتها وترتيباتها
   * @returns يكتمل عند حيازة قفل الزيارة حتى نهاية المعاملة لمنع تخصيص ترتيب مكرر
   */
  lock(sessionId: string): Promise<void>;
  /**
   * يدخل رأس زيارة واحدة دون تحديث زيارة محفوظة.
   *
   * @param record رأس الزيارة الجديد بهوية العميلة والمسجلة ووقت التنفيذ المثبتة
   * @returns يكتمل إدخال رأس الزيارة داخل المعاملة قبل إدخال بنودها وأثرها
   */
  insertSession(record: SessionRecord): Promise<void>;
  /**
   * يدخل المقبول وموظفاته دفعة واحدة داخل معاملة الطلب.
   *
   * @param lines البنود المقبولة بهوياتها وترتيباتها وموظفاتها ولقطات المال الموثقة
   * @returns يكتمل إدخال البنود والموظفات معاً كي لا تحفظ زيارة ناقصة عند فشل المعاملة
   */
  insertLines(lines: readonly SessionLine[]): Promise<void>;
}
/** كل ما يحتاجه الداخل معرّف هنا؛ persistence وحدها تعرف Tx. */
export interface SessionTransaction {
  discountMessages: { message_ar: string; message_en: string };
  place: SessionPlacePort; access: SessionRecordAccessPort; catalog: CatalogReaderPort; customer: CustomerLookupPort;
  performers: PerformerCheckPort; discount: DiscountLimitPort; repository: SessionRepository;
  /** قفل طلبات الموافقة واستهلاكها في معاملة السطر نفسها، فالسطر والموافقة يلتزمان معاً. */
  consumption: DiscountConsumptionPort;
  /**
   * يحفظ الرد والآثار معاً أو يعيد الرد الأصلي دون إعادة حساب المال.
   *
   * @param operation اسم الكتابة لعزل مفتاح إعادة الطلب بين إنشاء الزيارة والإضافة
   * @param work خطوات الكتابة التي تنفذ فقط إذا لم يوجد رد محفوظ لنفس البصمة
   * @returns الرد المحفوظ أو الجديد وعلامة replayed لإعادة التحقق من السلطة دون تكرار الآثار
   */
  idempotent<T>(operation: 'record-service-session' | 'append-service-session-lines', work: () => Promise<T>): Promise<{ body: T; replayed: boolean }>;
  /**
   * يكتب إنشاء الزيارة أو الإضافة ومال البنود المقبولة دون هاتف أو مرفوضات.
   *
   * @param record الزيارة التي تربط سجلات التدقيق بالعميلة والنشاط والفرع
   * @param added المقبول الجديد فقط لإثبات تغيير المال والمسجلة دون إعادة تدقيق القديم
   * @param outcome اكتمال الطلب أو رفض بعض خصوماته لإثبات نتيجة الكتابة
   * @param append يحدد فعل الإضافة أو الإنشاء في سجل التدقيق
   * @returns يكتمل حفظ تدقيق الزيارة والمال مع البنود داخل نفس المعاملة
   */
  audit(record: SessionRecord, added: readonly SessionLine[], outcome: 'COMPLETE' | 'PARTIAL', append: boolean): Promise<void>;
  /**
   * يكتب غلافاً واحداً للمقبول فقط في نفس معاملة المال.
   *
   * @param record رأس الزيارة الأصلي لنقل وقتها ونطاقها إلى المستهلكين
   * @param added المقبول الجديد وحده كي لا يعيد المستهلك احتساب البنود القديمة
   * @param append يختار ServiceSessionLinesAdded بدلاً من ServiceSessionRecorded
   * @returns يكتمل إدخال غلاف الحدث في outbox مع المال فلا ينشر أثر كتابة متراجعة
   */
  emit(record: SessionRecord, added: readonly SessionLine[], append: boolean): Promise<void>;
}
/** الحد الإلزامي للمعاملة يتيح اختبار التنسيق بدون قاعدة بيانات. */
export interface ServiceSessionTransactions {
  /**
   * يدخل الشركة الموثقة ويضمن التراجع عن كل أثر عند أي فشل، حتى فشل commit.
   *
   * @param context الشركة والكاتب ونطاق الزيارة ومفتاح الطلب وبصمته الموثقة لعزل المعاملة وإعادة الطلب
   * @param work خطوات القراءة والكتابة باستعمال منافذ نفس المعاملة لضمان ذرية الآثار
   * @returns نتيجة الخطوات بعد نجاح commit فقط؛ أي فشل يتراجع عن المال والتدقيق والحدث والرد المحفوظ
   */
  run<T>(context: SessionWriteContext, work: (tx: SessionTransaction) => Promise<T>): Promise<T>;
}
