import type { SessionWriteContext } from './service-session-transactions.port.ts';
import type {
  EditorNamePort,
  LineEditAuditEntry,
  LineEditRepository,
  SessionEditAccessPort,
} from './line-edit.port.ts';
import type { SessionLineIdentityPort } from './line-identity.port.ts';
import type { PerformerCheckPort, SessionPlacePort } from './session-readers.port.ts';

/** صف تاريخ الإلغاء؛ السبب يبقى هنا ولا يخرج إلى الحدث أو التدقيق. */
export interface ServiceLineCancellationInsert {
  id: string;
  previous_revision: number;
  revision: number;
  previous_price: bigint;
  previous_discount: bigint;
  previous_net: bigint;
  reason: string;
  cancelled_at: Date;
  cancelled_by: string;
  cancelled_by_membership_id: string;
  canceller_name_ar: string | null;
  canceller_name_en: string | null;
  canceller_role: string;
  canceller_role_is_system: boolean;
  canceller_role_name_ar: string | null;
  canceller_role_name_en: string;
}

/** أسطر الزيارة النشطة ومنفّذاتها الحالية لحارس البقشيش، بلا مبالغ. */
export interface ActiveLinePerformers {
  lines: readonly { id: string }[];
  performers_by_line: ReadonlyMap<string, readonly string[]>;
}

/** أحدث مجموعة بقشيش للزيارة؛ المبالغ لا تدخل حالة الاستخدام. */
export interface SessionTipsReadPort {
  /**
   * يعيد موظفات أحدث مراجعة بقشيش، أو مصفوفة فارغة إن لم توجد مراجعة أو كانت فارغة.
   *
   * @param sessionId هوية الزيارة تحت قفلها
   * @returns معرّفات الموظفات بلا تكرار وبلا مبالغ
   */
  currentEmployeeIds(sessionId: string): Promise<readonly string[]>;
}

/** تخزين الإلغاء؛ قفل الزيارة والسطر والزيارة المحفوظة من تخزين التعديل، واختلاف النطاق يرفض برفض موحّد. */
export interface LineCancelRepository extends Pick<LineEditRepository, 'lockVisit' | 'loadLineForUpdate' | 'loadSession'> {
  /**
   * يعيد الأسطر النشطة ومنفّذاتها الحالية لبناء حارس البقشيش.
   *
   * @param sessionId هوية الزيارة ضمن النشاط والفرع الحاليين
   * @returns معرّفات الأسطر النشطة وموظفات كل سطر
   */
  activePerformers(sessionId: string): Promise<ActiveLinePerformers>;
  /**
   * ينقل السطر إلى CANCELLED ويرفع نسخته إذا طابقت النسخة المتوقعة وكان نشطاً.
   *
   * @param sessionId هوية الزيارة
   * @param lineId هوية السطر
   * @param expectedRevision النسخة التي قرأتها الحالة
   * @returns هل تغيّر صف، ومعه النسخة الجديدة إن تغيّر
   */
  cancelLine(
    sessionId: string,
    lineId: string,
    expectedRevision: number,
  ): Promise<{ changed: false } | { changed: true; revision: number }>;
  /**
   * يدخل صف تاريخ الإلغاء داخل المعاملة.
   *
   * @param sessionId هوية الزيارة التي ينتمي إليها السطر
   * @param lineId هوية السطر الملغى
   * @param row صف التاريخ بما فيه السبب ولقطة الملغية
   * @returns يكتمل إدخال الصف أو يرفض إذا لم يطابق السطر النطاق
   */
  insertCancellation(sessionId: string, lineId: string, row: ServiceLineCancellationInsert): Promise<void>;
}

/** معاملة إلغاء بند واحد؛ الرد المخزون كامل والعرض يُحسب خارجها. */
export interface LineCancelTransaction {
  place: SessionPlacePort;
  access: SessionEditAccessPort;
  editors: EditorNamePort;
  performers: PerformerCheckPort;
  tips: SessionTipsReadPort;
  identities: SessionLineIdentityPort;
  lines: LineCancelRepository;
  /**
   * يحفظ الجسم الكامل تحت عملية الإلغاء أو يعيد الجسم المخزون.
   *
   * @param handler خطوات الإلغاء التي ترجع الجسم الكامل
   * @returns الجسم المخزون وهل كان إعادة إرسال
   */
  idempotent<T>(handler: () => Promise<T>): Promise<{ body: T; replayed: boolean }>;
  /**
   * يكتب أثر التدقيق داخل المعاملة نفسها.
   *
   * @param id هوية صف التدقيق
   * @param entry وصف الأثر بلا سبب وبلا أسماء
   * @returns يكتمل إدخال الأثر
   */
  audit(id: string, entry: LineEditAuditEntry): Promise<void>;
  /**
   * يكتب حدث تغيّر السطر في صندوق الصادر داخل المعاملة نفسها.
   *
   * @param id هوية الحدث
   * @param sessionId هوية الزيارة كجذر التجميع
   * @param payload حمولة السطر الواحد بلا سبب
   * @returns يكتمل إدخال الحدث
   */
  emit(id: string, sessionId: string, payload: unknown): Promise<void>;
}

/** مصنع معاملات الإلغاء؛ الساعة ومولّد الهويات يبقيان عند حالة الاستخدام. */
export interface LineCancelTransactions {
  /**
   * يشغّل الإلغاء داخل معاملة الشركة الواحدة.
   *
   * @param context سياق الكتابة المؤكد
   * @param work العمل داخل المعاملة
   * @returns نتيجة العمل
   */
  run<T>(context: SessionWriteContext, work: (tx: LineCancelTransaction) => Promise<T>): Promise<T>;
}
