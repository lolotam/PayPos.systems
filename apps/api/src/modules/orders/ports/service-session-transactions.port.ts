import type { SessionLine, SessionRecord } from '../domain/session-types.ts';
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
   * @param sessionId بيانات متحقق منها يحتاجها المستهلك
   * @returns نتيجة القراءة أو اكتمال الأثر داخل نفس المعاملة
   */
  load(sessionId: string): Promise<SessionRecord | null>;
  /**
   * يسلسل الإضافات قبل العد وتخصيص الترتيب دون UPDATE على رأس الزيارة.
   *
   * @param sessionId بيانات متحقق منها يحتاجها المستهلك
   * @returns نتيجة القراءة أو اكتمال الأثر داخل نفس المعاملة
   */
  lock(sessionId: string): Promise<void>;
  /**
   * يدخل رأس زيارة واحدة دون تحديث زيارة محفوظة.
   *
   * @param record بيانات متحقق منها يحتاجها المستهلك
   * @returns نتيجة القراءة أو اكتمال الأثر داخل نفس المعاملة
   */
  insertSession(record: SessionRecord): Promise<void>;
  /**
   * يدخل المقبول وموظفاته دفعة واحدة داخل معاملة الطلب.
   *
   * @param lines بيانات متحقق منها يحتاجها المستهلك
   * @returns نتيجة القراءة أو اكتمال الأثر داخل نفس المعاملة
   */
  insertLines(lines: readonly SessionLine[]): Promise<void>;
}
/** كل ما يحتاجه الداخل معرّف هنا؛ persistence وحدها تعرف Tx. */
export interface SessionTransaction {
  discountMessages: { message_ar: string; message_en: string };
  place: SessionPlacePort; access: SessionRecordAccessPort; catalog: CatalogReaderPort; customer: CustomerLookupPort;
  performers: PerformerCheckPort; discount: DiscountLimitPort; repository: SessionRepository;
  /**
   * يحفظ الرد والآثار معاً أو يعيد الرد الأصلي دون إعادة حساب المال.
   *
   * @param operation بيانات متحقق منها يحتاجها المستهلك
   * @param work بيانات متحقق منها يحتاجها المستهلك
   * @returns نتيجة القراءة أو اكتمال الأثر داخل نفس المعاملة
   */
  idempotent<T>(operation: 'record-service-session' | 'append-service-session-lines', work: () => Promise<T>): Promise<{ body: T; replayed: boolean }>;
  /**
   * يكتب إنشاء الزيارة أو الإضافة ومال البنود المقبولة دون هاتف أو مرفوضات.
   *
   * @param record بيانات متحقق منها يحتاجها المستهلك
   * @param added بيانات متحقق منها يحتاجها المستهلك
   * @param outcome بيانات متحقق منها يحتاجها المستهلك
   * @param append بيانات متحقق منها يحتاجها المستهلك
   * @returns نتيجة القراءة أو اكتمال الأثر داخل نفس المعاملة
   */
  audit(record: SessionRecord, added: readonly SessionLine[], outcome: 'COMPLETE' | 'PARTIAL', append: boolean): Promise<void>;
  /**
   * يكتب غلافاً واحداً للمقبول فقط في نفس معاملة المال.
   *
   * @param record بيانات متحقق منها يحتاجها المستهلك
   * @param added بيانات متحقق منها يحتاجها المستهلك
   * @param append بيانات متحقق منها يحتاجها المستهلك
   * @returns نتيجة القراءة أو اكتمال الأثر داخل نفس المعاملة
   */
  emit(record: SessionRecord, added: readonly SessionLine[], append: boolean): Promise<void>;
}
/** الحد الإلزامي للمعاملة يتيح اختبار التنسيق بدون قاعدة بيانات. */
export interface ServiceSessionTransactions {
  /**
   * يدخل الشركة الموثقة ويضمن التراجع عن كل أثر عند أي فشل، حتى فشل commit.
   *
   * @param context بيانات متحقق منها يحتاجها المستهلك
   * @param work بيانات متحقق منها يحتاجها المستهلك
   * @returns نتيجة القراءة أو اكتمال الأثر داخل نفس المعاملة
   */
  run<T>(context: SessionWriteContext, work: (tx: SessionTransaction) => Promise<T>): Promise<T>;
}
