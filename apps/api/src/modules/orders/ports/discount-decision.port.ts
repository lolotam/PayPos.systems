import type {
  DiscountDeciderSnapshot,
  DiscountDecisionPlan,
  LockedDiscountProposal,
} from '../domain/discount-decision-plan.ts';
import type { DiscountDecisionChannel } from '../domain/discount-decision-records.ts';
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

/** معرّف اقتراح ومعرّفات منفّذيه الثابتة اللازمة لترتيب الأقفال. */
export interface DiscountProposalPerformerIds {
  id: string;
  employee_ids: readonly string[];
}

/** جهاز الفرع الذي يطلب الموافقة: الشركة والجهاز والفرع، بلا مستخدم ولا جلسة. */
export interface DiscountDecisionDevice {
  companyId: string;
  deviceId: string;
  branchId: string;
}

/** ما يثبّت صاحب الاعتماد: الهاتف والرقم السري وطرفا جهاز الطلب. */
export interface DiscountPinVerification extends DiscountDecisionDevice {
  phone: string;
  pin: string;
}

/** نتيجة التحقق: صاحب الاعتماد وإصدار اعتماده، أو رفض أو قفل أو زحام. */
export type DiscountPinOutcome =
  | {
      kind: 'ok';
      userId: string;
      pinRevision: string;
      /** بيتأكد إن ارتباط الهاتف بصاحب الاعتماد لسه ثابت؛ النافذة المتبقية من إعادة الفحص لحد commit داخل المعاملة. */
      confirmBinding: () => Promise<boolean>;
    }
  | { kind: 'refused' }
  | { kind: 'locked' }
  | { kind: 'busy' };

/** التحقق من الرقم السري لطلب موافقة الخصم على جهاز مقترن. */
export interface DiscountPinApproverPort {
  /**
   * يقارن الهاتف والرقم السري خارج المعاملة ويعيد صاحب الاعتماد وإصداره أو سبب الرفض.
   * القاعدة: الرد قرار فقط؛ لا تجزئة ولا رقم سري ولا هاتف.
   *
   * @param verification الهاتف والرقم السري وطرفا جهاز الطلب
   * @returns صاحب الاعتماد وإصداره، أو رفض أو قفل أو زحام
   */
  verify(verification: DiscountPinVerification): Promise<DiscountPinOutcome>;
}

/** إثبات الاعتماد داخل المعاملة: الجهاز وصاحب الاعتماد وإصدار اعتماده. */
export interface DiscountPinFenceProof {
  deviceId: string;
  approverUserId: string;
  pinRevision: string;
  /** بيتأكد إن ارتباط الهاتف بصاحب الاعتماد لسه ثابت؛ النافذة المتبقية من إعادة الفحص لحد commit داخل المعاملة. */
  confirmBinding: () => Promise<boolean>;
}

/** حارس الاعتماد: يثبت أن الجهاز والإصدار ما زالا على حالهما حتى نهاية المعاملة. */
export interface DiscountPinFencePort {
  /**
   * يقفل صف الجهاز وصف اعتماد الرقم السري حتى نهاية المعاملة.
   *
   * @param proof الجهاز وصاحب الاعتماد وإصدار اعتماده المتحقق منه
   * @returns true ما زال الجهاز مقترناً فعالاً والإصدار نفسه، وfalse لأي سحب أو تغيير
   */
  lock(proof: DiscountPinFenceProof): Promise<boolean>;
}

/** قراءة نطاق الجهاز: النشاط الذي يخدمه الجهاز المقترن. */
export interface DiscountDeviceScopePort {
  /**
   * يعيد نشاط الجهاز المقترن في الشركة.
   *
   * @param device الشركة والجهاز والفرع
   * @returns معرّف النشاط، أو null لجهاز غير فعال أو من فرع آخر
   */
  businessOf(device: DiscountDecisionDevice): Promise<string | null>;
}

/** تخزين قرار الاقتراحات؛ النطاق والقفل وCAS مسؤوليته وحده. */
export interface DiscountDecisionRepository {
  /**
   * يقرأ معرّفات الاقتراحات ومعرّفات منفّذيها بلا أي قفل ليُعرف ما يُقفل قبلها.
   *
   * @param ids معرّفات الاقتراحات المطلوبة
   * @returns صفوف النطاق مرتبة بالمعرّف، ومعرّفات المنفّذين في كل صف فريدة وصغيرة ومرتبة
   */
  peek(ids: readonly string[]): Promise<readonly DiscountProposalPerformerIds[]>;
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
   * @param channel قناة القرار وجهازها؛ القرار البعيد بلا جهاز
   * @returns عدد الصفوف التي تغيّرت فعلاً لاكتشاف أي تعارض دفاعي
   */
  decide(
    plan: DiscountDecisionPlan,
    decider: DiscountDeciderSnapshot,
    channel: DiscountDecisionChannel,
  ): Promise<number>;
}

/** معاملة القرار؛ كل القراءات والآثار على اتصال المستأجر نفسه. */
export interface DiscountDecisionTransaction {
  access: DiscountApprovalAccessPort;
  discount: DiscountLimitPort;
  approverName: EditorNamePort;
  performers: PerformerCheckPort;
  proposals: DiscountDecisionRepository;
  /**
   * يثبت داخل المعاملة أن الجهاز والإصدار الذي تحقّق منه ما زالا على حالهما.
   *
   * @returns true ما زال الجهاز فعالاً والإصدار نفسه، وfalse لأي سحب أو تغيير
   */
  fence: DiscountPinFencePort;
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
