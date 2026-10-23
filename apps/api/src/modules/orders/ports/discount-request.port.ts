import type { SessionAccess } from '../domain/session-authority.ts';
import type { DiscountProposalPlan } from '../domain/discount-request.ts';
import type { EditorNamePort, SessionEditorMembership } from './line-edit.port.ts';
import type { SessionRepository, SessionWriteContext } from './service-session-transactions.port.ts';
import type {
  CatalogReaderPort,
  CustomerLookupPort,
  DiscountLimitPort,
  PerformerCheckPort,
  SessionPlacePort,
} from './session-readers.port.ts';

/** سلطة التسجيل التي يقرأها الطلب؛ تحمل أدوار العضويات لالتقاط لقطة D-18. */
export interface DiscountRequestAccessPort {
  /**
   * يثبت الشركة ثم العضويات بأقفال SHARE المتوافقة مع الكتالوج.
   *
   * @returns يكتمل عند حيازة الأقفال حتى نهاية المعاملة
   */
  lock(): Promise<void>;
  /**
   * يعيد سلطة التسجيل وأدوار العضويات عند اللحظة المحقونة.
   *
   * @param at اللحظة المحقونة بعد الأقفال أو عند إعادة الإرسال
   * @returns الإذن والمنع والميزة والعضويات المتاحة في الفرع ودور كل عضوية
   */
  read(at: Date): Promise<SessionAccess & { memberships: readonly SessionEditorMembership[] }>;
}

/** تخزين الاقتراحات؛ الاقتراحات والمنفّذون في نداء واحد حتى لا يُحفظ طلب ناقص. */
export interface DiscountProposalRepository {
  /**
   * يدخل الاقتراحات وصفوف منفّذيها دفعة واحدة داخل معاملة الطلب.
   *
   * @param proposals الاقتراحات الجاهزة بكل لقطاتها
   * @returns يكتمل إدخال كل الصفوف أو يتراجع عنها كلها
   */
  insert(proposals: readonly DiscountProposalPlan[]): Promise<void>;
}

/** تجزئة الشروط؛ الـ domain لا يستورد `node:crypto`، فالمحوّل يجيبها (CLAUDE.architecture.md §4.1). */
export interface TermsHashPort {
  /**
   * يعيد بصمة SHA-256 بطول أربعة وستين حرفاً hex صغير للنص المُعطى.
   *
   * @param text النص القانوني للشروط
   * @returns البصمة
   */
  sha256Hex(text: string): string;
}

/** أثر التدقيق الآمن لطلب موافقة: بلا اسم عميلة ولا هاتف ولا اسم منفّذ (FR-022). */
export interface DiscountProposalAuditEntry {
  entity: string;
  entityId: string;
  action: string;
  after: unknown;
}

/** معاملة طلب الموافقة؛ كل ما يحتاجه الدخول معرّف هنا. */
export interface DiscountRequestTransaction {
  place: SessionPlacePort;
  access: DiscountRequestAccessPort;
  catalog: CatalogReaderPort;
  customer: CustomerLookupPort;
  performers: PerformerCheckPort;
  discount: DiscountLimitPort;
  requesterName: EditorNamePort;
  sessions: Pick<SessionRepository, 'load' | 'lock'>;
  proposals: DiscountProposalRepository;
  /**
   * يحفظ الرد والآثار معاً أو يعيد الرد الأصلي دون إعادة حساب المال.
   *
   * @param work خطوات الطلب التي تنفذ فقط إذا لم يوجد رد محفوظ لنفس البصمة
   * @returns الرد المحفوظ أو الجديد وعلامة replayed لإعادة التحقق من السلطة دون تكرار الآثار
   */
  idempotent<T>(work: () => Promise<T>): Promise<{ body: T; replayed: boolean }>;
  /**
   * يكتب أثر التدقيق داخل معاملة الطلب نفسها.
   *
   * @param entries أوصاف الأثر، أثر لكل اقتراح
   * @returns يكتمل إدخال الأثر
   */
  audit(entries: readonly DiscountProposalAuditEntry[]): Promise<void>;
  /**
   * يكتب حدث الطلب في صندوق الصادر داخل معاملة الطلب نفسها.
   *
   * @param requestId معرّف الطلب الذي هو جذر التجميع
   * @param payload حمولة الطلب بلا عميلة ولا هاتف
   * @returns يكتمل إدخال الحدث
   */
  emit(requestId: string, payload: unknown): Promise<void>;
}

/** مصنع معاملات الطلب؛ الساعة ومولّد الهويات يبقيان عند حالة الاستخدام. */
export interface DiscountRequestTransactions {
  /**
   * يدخل الشركة الموثقة ويضمن التراجع عن كل أثر عند أي فشل، حتى فشل commit.
   *
   * @param context الشركة والكاتب والنطاق ومفتاح الطلب وبصمته الموثقة لعزل المعاملة وإعادة الطلب
   * @param work خطوات القراءة والكتابة باستعمال منافذ نفس المعاملة لضمان ذرية الآثار
   * @returns نتيجة الخطوات بعد نجاح commit فقط
   */
  run<T>(context: SessionWriteContext, work: (tx: DiscountRequestTransaction) => Promise<T>): Promise<T>;
}
