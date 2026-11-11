import type {
  DiscountDeciderSnapshot,
  DiscountDecisionPlan,
  LockedDiscountProposal,
} from '../domain/discount-decision-plan.ts';
import type { DiscountProposalAuditEntry } from './discount-request.port.ts';
import type { EditorNamePort, SessionEditFacts } from './line-edit.port.ts';
import type { SessionWriteContext } from './service-session-transactions.port.ts';
import type { DiscountLimitPort, PerformerCheckPort } from './session-readers.port.ts';

/** سلطة الموافقة تُقفل ثم تُعاد قراءتها عند اللحظة المحقونة، بما فيها قبل replay. */
export interface DiscountApprovalAccessPort {
  /**
   * يثبت الشركة ثم عضويات الموافقة بأقفال SHARE قبل قفل الاقتراحات.
   *
   * @returns يكتمل حيازة الأقفال حتى نهاية المعاملة
   */
  lock(): Promise<void>;
  /**
   * يعيد المنع والميزة والعضويات التي تغطي الفرع وتمنح الموافقة بذاتها.
   *
   * @param at اللحظة المحقونة بعد كل الأقفال أو عند إعادة الإرسال
   * @returns حقائق السلطة ولقطات أدوار العضويات المؤهلة
   */
  read(at: Date): Promise<SessionEditFacts>;
}

/** تخزين قرار الاقتراحات؛ النطاق والقفل وCAS مسؤوليته وحده. */
export interface DiscountDecisionRepository {
  /**
   * يقفل اقتراحات هذا النشاط والفرع تصاعدياً ويعيدها مع لقطات منفّذيها.
   *
   * @param ids معرّفات الاقتراحات المطلوبة
   * @returns الصفوف الموجودة في النطاق بترتيب المعرّف التصاعدي
   */
  lock(ids: readonly string[]): Promise<readonly LockedDiscountProposal[]>;
  /**
   * يطبّق خطة القرار بشرط بقاء كل صف معلقاً وغير منتهٍ عند اللحظة نفسها.
   *
   * @param plan خطة الموافقة أو الرفض المكتملة
   * @param decider لقطة الاسم والدور التي تُحفظ مع القرار
   * @returns عدد الصفوف التي تغيّرت فعلاً لاكتشاف أي تعارض دفاعي
   */
  decide(plan: DiscountDecisionPlan, decider: DiscountDeciderSnapshot): Promise<number>;
}

/** معاملة القرار؛ كل القراءات والآثار على اتصال المستأجر نفسه. */
export interface DiscountDecisionTransaction {
  access: DiscountApprovalAccessPort;
  discount: DiscountLimitPort;
  approverName: EditorNamePort;
  performers: PerformerCheckPort;
  proposals: DiscountDecisionRepository;
  /**
   * يحفظ الرد 200 مع القرار والتدقيق والحدث، أو يعيد الرد الأصلي بلا كتابة جديدة.
   *
   * @param work خطوات القرار التي تنفذ عند غياب رد محفوظ
   * @returns الرد المحفوظ وعلامة replayed لإعادة فحص السلطة فقط
   */
  idempotent<T>(work: () => Promise<T>): Promise<{ body: T; replayed: boolean }>;
  /**
   * يكتب آثار التدقيق داخل معاملة القرار نفسها.
   *
   * @param entries أثر آمن لكل اقتراح، بلا سبب رفض أو بيانات اتصال
   * @returns يكتمل إدخال الآثار
   */
  audit(entries: readonly DiscountProposalAuditEntry[]): Promise<void>;
  /**
   * يكتب حدث الموافقة على شغل المُوافِق داخل معاملة القرار نفسها.
   *
   * @param payload حمولة الحدث المعلّم فقط
   * @returns يكتمل إدخال الحدث
   */
  emit(payload: unknown): Promise<void>;
}

/** مصنع معاملة القرار الواحدة وعزل مفتاح idempotency وبصمته. */
export interface DiscountDecisionTransactions {
  /**
   * يدخل الشركة الموثقة ويضمن ذرية القرار والتدقيق والحدث والرد المحفوظ.
   *
   * @param context الشركة والكاتب والنطاق ومفتاح الطلب وبصمته الموثقة
   * @param work خطوات القراءة والكتابة باستعمال منافذ المعاملة نفسها
   * @returns نتيجة العمل بعد نجاح commit فقط
   */
  run<T>(context: SessionWriteContext, work: (tx: DiscountDecisionTransaction) => Promise<T>): Promise<T>;
}
