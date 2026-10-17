import type { SessionLimit, SessionRecord } from '../domain/session-types.ts';
import type { SessionWriteContext } from './service-session-transactions.port.ts';
import type { DiscountLimitPort, PerformerCheckPort, SessionPlacePort } from './session-readers.port.ts';

/** لقطة دور العضوية التي يُنسب إليها التعديل. */
export interface SessionEditorRole {
  code: string;
  is_system: boolean;
  name_ar: string | null;
  name_en: string;
}

/** عضوية مؤهلة بذاتها لتعديل سعر البند على هذا الفرع. */
export interface SessionEditorMembership {
  membership_id: string;
  role: SessionEditorRole;
}

/** حقائق التعديل بعد حماية المالك؛ القراءة مستقلة عن أهلية التعديل. */
export interface SessionEditFacts {
  denied: boolean;
  feature: boolean;
  can_read: boolean;
  eligible: readonly SessionEditorMembership[];
}

/** منفّذة السطر المقفول: لقطة التسجيل لا الرابط الحالي. */
export interface LockedLinePerformer {
  employee_id: string;
  linked_user_id: string | null;
  linked_user_snapshotted: boolean;
}

/** السطر ورأس الزيارة تحت قفل السطر؛ المبالغ بالفلس. */
export interface LockedServiceLine {
  status: 'ACTIVE' | 'CANCELLED';
  revision: number;
  list_price: bigint;
  price: bigint;
  discount: bigint;
  net: bigint;
  effective_discount_bps: number;
  limit_bps_applied: number | null;
  limit_source: SessionLimit['source'];
  business_date: string;
  business_timezone: string;
  occurred_at: Date;
  performers: readonly LockedLinePerformer[];
}

/** الأعمدة السبعة الممنوحة للكتابة، مع النسخة المتوقعة للمقارنة. */
export interface LinePriceUpdate {
  price: bigint;
  discount: bigint;
  net: bigint;
  effective_discount_bps: number;
  limit_bps_applied: number | null;
  limit_source: SessionLimit['source'];
  expected_revision: number;
}

/** صف تاريخ التعديل؛ السبب يبقى هنا ولا يخرج إلى الحدث أو التدقيق. */
export interface ServiceLineEditInsert {
  id: string;
  previous_revision: number;
  revision: number;
  previous_price: bigint;
  previous_discount: bigint;
  previous_net: bigint;
  new_price: bigint;
  new_discount: bigint;
  new_net: bigint;
  previous_effective_discount_bps: number;
  previous_limit_bps_applied: number | null;
  previous_limit_source: SessionLimit['source'];
  new_effective_discount_bps: number;
  new_limit_bps_applied: number | null;
  new_limit_source: SessionLimit['source'];
  reason: string;
  changed_at: Date;
  changed_by: string;
  changed_by_membership_id: string;
  editor_name_ar: string | null;
  editor_name_en: string | null;
  editor_role: string;
  editor_role_is_system: boolean;
  editor_role_name_ar: string | null;
  editor_role_name_en: string;
}

/** أثر التدقيق الآمن؛ بلا سبب وبلا أسماء. */
export interface LineEditAuditEntry {
  entity: string;
  entityId: string;
  action: string;
  after: unknown;
}

/** سلطة التعديل تُعاد قبل المطالبة وبعد الانتظار. */
export interface SessionEditAccessPort {
  /**
   * يثبت الشركة ثم عضويات التعديل بأقفال SHARE نفسها المستخدمة للتسجيل.
   *
   * @returns يكتمل حيازة الأقفال حتى نهاية المعاملة
   */
  lock(): Promise<void>;
  /**
   * يعيد حقائق التعديل والقراءة عند اللحظة المحقونة.
   *
   * @param at اللحظة المحقونة بعد الأقفال أو عند إعادة الإرسال
   * @returns المنع والميزة وحق القراءة والعضويات المؤهلة بذاتها
   */
  read(at: Date): Promise<SessionEditFacts>;
}

/** اسم الموظفة يُلتقط من نشاط السطر فقط. */
export interface EditorNamePort {
  /**
   * يعيد اسم الموظفة النشطة للمستخدم داخل نشاط السطر.
   *
   * @param userId مستخدمة التعديل
   * @returns الاسمان أو null إذا لم ترتبط بموظفة نشطة في هذا النشاط
   */
  read(userId: string): Promise<{ name_ar: string | null; name_en: string } | null>;
}

/** تخزين التعديل؛ اختلاف النطاق يعيد null فيرفض النداء برفض موحّد. */
export interface LineEditRepository {
  /**
   * يسلسل تعديلات الزيارة بنفس القفل الاستشاري المستخدم للتسجيل والإضافة.
   *
   * @param sessionId هوية الزيارة التي تتنافس التعديلات على نسخة بنودها
   * @returns يكتمل عند حيازة قفل الزيارة حتى نهاية المعاملة
   */
  lockVisit(sessionId: string): Promise<void>;
  /**
   * يقفل السطر ويعيد حالته ونسخته وماله ومنفّذاته ورأس الزيارة.
   *
   * @param sessionId هوية الزيارة ضمن النشاط والفرع الحاليين
   * @param lineId هوية السطر المطلوب تعديله داخل تلك الزيارة
   * @returns السطر المقفول أو null إذا لم يطابق النطاق
   */
  loadLineForUpdate(sessionId: string, lineId: string): Promise<LockedServiceLine | null>;
  /**
   * يعيد صوافي البنود النشطة الأخرى في الزيارة نفسها.
   *
   * @param sessionId هوية الزيارة
   * @param exceptLineId السطر الجاري تعديله ولا يدخل صافيه القديم في المجموع
   * @returns صوافي البنود النشطة الأخرى بالفلس
   */
  activeNets(sessionId: string, exceptLineId: string): Promise<readonly bigint[]>;
  /**
   * يحدّث الأعمدة السبعة الممنوحة فقط إذا طابقت النسخة المتوقعة.
   *
   * @param sessionId هوية الزيارة
   * @param lineId هوية السطر
   * @param update المال الجديد والنسخة المتوقعة
   * @returns هل تغيّر صف، ومعه النسخة الجديدة إن تغيّر
   */
  updateLine(
    sessionId: string,
    lineId: string,
    update: LinePriceUpdate,
  ): Promise<{ changed: false } | { changed: true; revision: number }>;
  /**
   * يدخل صف تاريخ التعديل بكل أعمدته داخل المعاملة.
   *
   * @param sessionId هوية الزيارة التي ينتمي إليها السطر
   * @param lineId هوية السطر المعدّل
   * @param edit صف التاريخ بما فيه السبب ولقطة المحررة
   * @returns يكتمل إدخال الصف أو يرفض إذا لم يطابق السطر النطاق
   */
  insertEdit(sessionId: string, lineId: string, edit: ServiceLineEditInsert): Promise<void>;
  /**
   * يحمل الزيارة بعد الحفظ لبناء الرد والحدث من الصف المحفوظ.
   *
   * @param sessionId هوية الزيارة ضمن النشاط والفرع الحاليين
   * @returns الزيارة وبنودها أو null إذا خرجت عن النطاق
   */
  loadSession(sessionId: string): Promise<SessionRecord | null>;
}

/** معاملة تعديل بند واحد؛ الرد المخزون كامل والعرض يُحسب خارجها. */
export interface LineEditTransaction {
  place: SessionPlacePort;
  access: SessionEditAccessPort;
  editors: EditorNamePort;
  performers: PerformerCheckPort;
  discount: DiscountLimitPort;
  lines: LineEditRepository;
  /**
   * يحفظ الجسم الكامل تحت عملية تعديل السعر أو يعيد الجسم المخزون.
   *
   * @param handler خطوات التعديل التي ترجع الجسم الكامل
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

/** مصنع معاملات التعديل؛ الساعة ومولّد الهويات يبقيان عند حالة الاستخدام. */
export interface LineEditTransactions {
  /**
   * يشغّل التعديل داخل معاملة الشركة الواحدة.
   *
   * @param context سياق الكتابة المؤكد
   * @param work العمل داخل المعاملة
   * @returns نتيجة العمل
   */
  run<T>(context: SessionWriteContext, work: (tx: LineEditTransaction) => Promise<T>): Promise<T>;
}
