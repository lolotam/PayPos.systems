import type { TipPerformerRow } from '../domain/tip-people-links.ts';
import type { TipRevisionSession } from '../domain/tip-records.ts';
import type { TipEntry } from '../domain/tip-set.ts';
import type { PerformerCheckPort, SessionRecordAccessPort } from './session-readers.port.ts';
import type { SessionWriteContext } from './service-session-transactions.port.ts';

/** المجموعة الحالية؛ المراجعة صفر والسطور فاضية تعني أنه لا بقشيش محفوظ بعد. */
export interface SessionTipsCurrent {
  revision: number;
  entries: readonly TipEntry[];
}

/** صف المراجعة؛ السبب يبقى هنا، وكل سطر يحمل هوية من مولّد النداء لأن session_tips.id بلا قيمة افتراضية. */
export interface SessionTipRevisionInsert {
  id: string;
  event_id: string;
  revision: number;
  previous_revision: number | null;
  changed_by: string;
  changed_by_membership_id: string;
  changed_at: Date;
  reason: string | null;
  entries: readonly ({ id: string } & TipEntry)[];
}

/** أثر التدقيق الآمن؛ بلا سبب وبلا هاتف وبلا اسم عميلة. */
export interface SessionTipsAuditEntry {
  entity: string;
  entityId: string;
  action: string;
  before: unknown;
  after: unknown;
}

/** سلطة تسجيل البقشيش هي منفذ تسجيل الزيارة نفسه حتى لا يُنسخ القفل وإعادة الفحص. */
export type SessionTipsAccessPort = SessionRecordAccessPort;

/** تخزين مراجعات البقشيش؛ اختلاف النطاق يعيد null فيرفض النداء برفض موحّد. */
export interface SessionTipsRepository {
  /**
   * يسلسل كتابات الزيارة بنفس القفل المستخدم للتسجيل حتى لا تمر نسختان معاً.
   *
   * @param sessionId هوية الزيارة التي تتنافس مراجعات بقشيشها
   * @returns يكتمل عند حيازة قفل الزيارة حتى نهاية المعاملة
   */
  lockVisit(sessionId: string): Promise<void>;
  /**
   * يعيد رأس الزيارة داخل النشاط والفرع الحاليين لبناء الحدث والنافذة.
   *
   * @param sessionId هوية الزيارة
   * @returns الرأس بما فيه وقت الزيارة وتاريخها ومنطقتها، أو null إذا خرجت عن النطاق
   */
  loadSession(sessionId: string): Promise<TipRevisionSession | null>;
  /**
   * يعيد صفاً لكل منفّذة من line_performers فقط، بلا current_user_id.
   *
   * @param sessionId هوية الزيارة
   * @returns الهوية وحالة السطر ولقطات الهوية، بلا دمج وبلا ربط حالي
   */
  loadPeople(sessionId: string): Promise<readonly TipPerformerRow[]>;
  /**
   * يعيد أعلى مراجعة وسطورها للمقارنة مع النسخة المتوقعة.
   *
   * @param sessionId هوية الزيارة
   * @returns المراجعة الحالية، أو صفر وسطور فاضية إذا لم يُسجَّل بقشيش بعد
   */
  loadCurrent(sessionId: string): Promise<SessionTipsCurrent>;
  /**
   * يدخل المراجعة وسطورها في المعاملة نفسها حتى تبقى السلسلة والحدث مترابطين.
   *
   * @param sessionId هوية الزيارة التي تُنسب إليها المراجعة
   * @param row المراجعة الجديدة وسببها إن وُجد والمجموعة الكاملة
   * @returns يكتمل إدخال الصفوف أو يرفض إذا لم تطابق الزيارة النطاق
   */
  insertRevision(sessionId: string, row: SessionTipRevisionInsert): Promise<void>;
}

/**
 * ترتيب D-T6: مطالبة idempotent ثم access.lock ثم lockVisit ثم loadSession و loadPeople و loadCurrent،
 * ثم performers.lock لاتحاد هويات الناس والحالية والمطلوبة تصاعدياً ودفعات لا تزيد عن 80 لأن قارئ الموارد البشرية يرفض الأكثر،
 * ثم performers.read ثم withCurrentLinks لهويات الناس والحالية فقط ثم access.read الطازج ثم القواعد ثم insertRevision ثم audit ثم emit.
 */
export interface SessionTipsTransaction {
  access: SessionTipsAccessPort;
  performers: PerformerCheckPort;
  tips: SessionTipsRepository;
  /**
   * يحفظ جسم الرد تحت عملية تسجيل البقشيش أو يعيد الجسم المخزون.
   *
   * @param handler خطوات التسجيل التي ترجع جسم الرد
   * @returns الجسم المخزون وهل كان إعادة إرسال
   */
  idempotent<T>(handler: () => Promise<T>): Promise<{ body: T; replayed: boolean }>;
  /**
   * يكتب أثر التدقيق داخل المعاملة نفسها.
   *
   * @param id هوية صف التدقيق
   * @param entry وصف الأثر بلا سبب وبلا هاتف
   * @returns يكتمل إدخال الأثر
   */
  audit(id: string, entry: SessionTipsAuditEntry): Promise<void>;
  /**
   * يكتب حدث تغيّر البقشيش في صندوق الصادر داخل المعاملة نفسها.
   *
   * @param id هوية الحدث، وهي نفسها event_id المراجعة
   * @param sessionId هوية الزيارة كجذر التجميع
   * @param payload حمولة المجموعة الحالية بلا سبب
   * @returns يكتمل إدخال الحدث
   */
  emit(id: string, sessionId: string, payload: unknown): Promise<void>;
}

/** مصنع معاملات البقشيش؛ الساعة ومولّد الهويات يبقيان عند حالة الاستخدام. */
export interface SessionTipsTransactions {
  /**
   * يشغّل تسجيل البقشيش داخل معاملة الشركة الواحدة.
   *
   * @param context سياق الكتابة المؤكد
   * @param work العمل داخل المعاملة
   * @returns نتيجة العمل
   */
  run<T>(
    context: SessionWriteContext,
    work: (tx: SessionTipsTransaction) => Promise<T>,
  ): Promise<T>;
}
