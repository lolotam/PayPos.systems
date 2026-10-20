import type { LinePerformerRow } from '../domain/line-performers-plan.ts';
import type {
  EditorNamePort,
  LineEditAuditEntry,
  LineEditRepository,
  SessionEditAccessPort,
} from './line-edit.port.ts';
import type { SessionLineIdentityPort } from './line-identity.port.ts';
import type { PerformerCheckPort, SessionPlacePort } from './session-readers.port.ts';
import type { SessionWriteContext } from './service-session-transactions.port.ts';

/** صف تاريخ تغيير المنفّذين؛ السبب يبقى هنا ولا يخرج إلى الحدث أو التدقيق. */
export interface ServiceLinePerformerChangeInsert {
  id: string;
  previous_revision: number;
  revision: number;
  reason: string;
  changed_at: Date;
  changed_by: string;
  changed_by_membership_id: string;
  changer_name_ar: string | null;
  changer_name_en: string | null;
  changer_role: string;
  changer_role_is_system: boolean;
  changer_role_name_ar: string | null;
  changer_role_name_en: string;
}

/** صف منفّذة جاهز للحفظ؛ هويته من مولّد الهويات في حالة الاستخدام لا من التخزين. */
export type StoredPerformerRow = LinePerformerRow & { id: string };

/** تخزين تغيير المنفّذين؛ قفل الزيارة والسطر والزيارة المحفوظة من تخزين التعديل، واختلاف النطاق يرفض برفض موحّد. */
export interface LinePerformersRepository extends Pick<LineEditRepository, 'lockVisit' | 'loadLineForUpdate' | 'loadSession'> {
  /**
   * يعيد منفّذات السطر كما هي محفوظة الآن بترتيبهن المحفوظ، بلا تطبيع لأي قيمة.
   *
   * @param sessionId هوية الزيارة ضمن النشاط والفرع الحاليين
   * @param lineId هوية السطر المطلوب تغييره داخل تلك الزيارة
   * @returns الصفوف التسعة لكل منفّذة بترتيب رقم المنفّذة
   */
  currentPerformers(sessionId: string, lineId: string): Promise<LinePerformerRow[]>;
  /**
   * يقول هل عُدّل سعر السطر قبل هذا التغيير؛ علامة «معدَّل» تأتي من وجود صف تعديل سعر لا من رقم النسخة.
   *
   * @param sessionId هوية الزيارة ضمن النشاط والفرع الحاليين
   * @param lineId هوية السطر المطلوب
   * @returns هل يوجد صف تعديل سعر لهذا السطر
   */
  isPriceEdited(sessionId: string, lineId: string): Promise<boolean>;
  /**
   * يدخل رأس تاريخ تغيير المنفّذين داخل المعاملة.
   *
   * @param sessionId هوية الزيارة التي ينتمي إليها السطر
   * @param lineId هوية السطر المتغيّر
   * @param header صف التاريخ بما فيه السبب ولقطة صاحبة التغيير
   * @returns يكتمل إدخال الصف أو يرفض إذا لم يطابق السطر النطاق
   */
  insertChange(sessionId: string, lineId: string, header: ServiceLinePerformerChangeInsert): Promise<void>;
  /**
   * يدخل صفّاً واحداً من جانب التاريخ؛ الجانب BEFORE يوصف ما كان محفوظاً والجانب AFTER ما صار محفوظاً.
   *
   * @param changeId هوية رأس التغيير في المعاملة نفسها
   * @param side جانب التاريخ المدخل
   * @param rows صفوف الجانب بالتسعة أعمدة نفسها
   * @returns يكتمل إدخال الصف
   */
  insertSide(changeId: string, side: 'BEFORE' | 'AFTER', rows: readonly StoredPerformerRow[]): Promise<void>;
  /**
   * يرفع نسخة السطر ويرفع راية تنبيه المنفّذات، ولا يمس أي عمود آخر.
   *
   * @param sessionId هوية الزيارة
   * @param lineId هوية السطر
   * @param expectedRevision النسخة التي قرأتها الحالة
   * @param hasPerformerWarning راية التنبيه الجديدة بعد المجموعة
   * @returns هل تغيّر صف، ومعه النسخة الجديدة إن تغيّر
   */
  bumpRevision(
    sessionId: string,
    lineId: string,
    expectedRevision: number,
    hasPerformerWarning: boolean,
  ): Promise<{ changed: false } | { changed: true; revision: number }>;
  /**
   * يستبدل مجموعة المنفّذات الحيّة بالمجموعة الجديدة: الحذف أولاً ثم الإدخال.
   *
   * @param sessionId هوية الزيارة
   * @param lineId هوية السطر
   * @param rows المجموعة الجديدة كاملة بترتيب الطلب
   * @returns يكتمل الحذف والإدخال
   */
  replacePerformers(sessionId: string, lineId: string, rows: readonly StoredPerformerRow[]): Promise<void>;
}

/** معاملة تغيير منفّذات بند واحد؛ الرد المخزون كامل والعرض يُحسب خارجها. */
export interface LinePerformersTransaction {
  place: SessionPlacePort;
  access: SessionEditAccessPort;
  editors: EditorNamePort;
  performers: PerformerCheckPort;
  identities: SessionLineIdentityPort;
  lines: LinePerformersRepository;
  /**
   * يحفظ الجسم الكامل تحت عملية تغيير المنفّذين أو يعيد الجسم المخزون.
   *
   * @param handler خطوات التغيير التي ترجع الجسم الكامل
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

/** مصنع معاملات تغيير المنفّذين؛ الساعة ومولّد الهويات يبقيان عند حالة الاستخدام. */
export interface LinePerformersTransactions {
  /**
   * يشغّل تغيير المنفّذين داخل معاملة الشركة الواحدة.
   *
   * @param context سياق الكتابة المؤكد
   * @param work العمل داخل المعاملة
   * @returns نتيجة العمل
   */
  run<T>(context: SessionWriteContext, work: (tx: LinePerformersTransaction) => Promise<T>): Promise<T>;
}
