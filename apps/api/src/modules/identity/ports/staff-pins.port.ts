import type { StaffDeviceContext, StaffSessions } from '@pospay/auth';
import type { AuditTrail } from '../../../shared/ports/audit-trail.port.ts';
import type { OutboxWriter } from '../../../shared/ports/outbox-writer.port.ts';
export type { StaffPinComparisonGate } from '../domain/staff-pin-comparison-gate.ts';

/** اعتماد المستخدم الموجود في الشركة؛ لا يمثل سجلاً في staff أو إثبات حضور. */
export interface StaffPinRecord {
  readonly id: string;
  readonly hash: string;
  readonly temporary?: boolean;
  /** لحظة انتهاء الرقم المؤقت؛ null يعني إن مفيش انتهاء. */
  readonly expiresAt?: Date | null;
}

/** دليل تغيير الرقم السري: النص اللي بيتسلّم للعميل مرة واحدة، وبصمته اللي بتتخزن. */
export interface StaffPinProof {
  /** الدليل الخام — بيتسلّم للعميل، وما بيتكتبش في أي log ولا audit. */
  readonly proof: string;
  /** بصمة SHA-256 hex للدليل — دي اللي بتتخزن. */
  readonly hash: string;
}

/** دليل تغيير الرقم السري كما هو مخزن: البصمة بتحدد صاحبه وإصدار الـPIN وقت الإصدار. */
export interface StaffPinProofRecord {
  /** صاحب الرقم المؤقت وقت إصدار الدليل. */
  readonly userId: string;
  /** نسخة الـPIN وقت الإصدار — تبديل الرقم بعد كده بيبطل الدليل. */
  readonly pinRevision: string;
  /** لحظة انتهاء الدليل. */
  readonly expiresAt: Date | null;
  /** لحظة استهلاك الدليل؛ null يعني لسه مستخدم. */
  readonly consumedAt: Date | null;
}

/**
 * مولّد أدلة تغيير الرقم السري: هو الوحيد اللي يعمل عشوائية تشفيرية، والـuse case مالهوش أي وصول
 * لـnode:crypto (CLAUDE.md §4.2). الدليل بيتولد بـ32 بايت عشوائية وbase64url، وبصمته SHA-256 hex.
 */
export interface StaffPinProofIssuer {
  /**
   * يولّد دليلاً جديداً مع بصمته.
   *
   * @returns الدليل الخام وبصمته
   */
  issue(): StaffPinProof;
  /**
   * بصمة دليل وصل من العميل — نفس SHA-256 hex بتاع الإصدار.
   *
   * @param proof الدليل كما وصل من العميل
   * @returns بصمة الدليل
   */
  digest(proof: string): string;
}

/** معاملة الشركة وحدها تقرأ أو تبدل الاعتماد وتكتب أثر المدير الحقيقي. */
export interface StaffPinScope {
  readonly audit: AuditTrail;
  /**
   * عضوية سارية في الشركة نفسها، دون إنشاء أو تغيير عضويات.
   *
   * @param userId المستخدم المستهدف
   */
  member(userId: string): Promise<boolean>;
  /**
   * لا تعيد PIN ولا أي بيانات مستخدم عالمي. حالة المؤقت ترجع مع الـ hash عشان المقارنة وعداد الغلطات يفضلوا لنفس المستخدم قبل الرفض (FR-F2-2).
   *
   * @param userId صاحب الاعتماد
   */
  find(userId: string): Promise<StaffPinRecord | null>;
  /**
   * قراءة مقفولة بـ `SELECT … FOR SHARE` لصف الاعتماد داخل المعاملة، فتُرى أي إعادة تعيين التزمت قبلها وتنتظر أي إعادة تعيين متزامنة حتى انتهاء التحقق والأثر.
   *
   * @param userId صاحب الاعتماد
   */
  findLocked(userId: string): Promise<StaffPinRecord | null>;
  /**
   * يتبدل id مع كل reset كي لا يقبل إصدار الجلسة مقارنة لاعتماد قديم.
   * الرقم بيتخزن مؤقتاً (ينتهي بعد 24 ساعة) لو صاحب الاعتماد عنده سجل «إعطاء الدخول»
   * في الشركة، ودائماً لغيره (AC-ACT-9).
   *
   * @param userId صاحب الاعتماد
   * @param hash الـ hash الناتج من المصادقة
   * @param actor المدير الحقيقي
   * @param at وقت التغيير
   */
  save(userId: string, hash: string, actor: string, at: Date): Promise<void>;
  /**
   * بيصدر دليل تغيير للرقم المؤقت: البصمة بس بتتخزن، والدليل الخام بيرجع للعميل من الـuse case.
   *
   * @param proof صف الدليل
   * @param proof.id معرف صف الدليل
   * @param proof.userId صاحب الرقم المؤقت
   * @param proof.deviceId الجهاز اللي issued عليه الدليل
   * @param proof.pinRevision إصدار الـPIN وقت الإصدار
   * @param proof.proofHash بصمة الدليل
   * @param proof.at لحظة الإصدار
   * @param proof.expiresAt لحظة انتهاء الدليل
   */
  issueProof(proof: {
    readonly id: string;
    readonly userId: string;
    readonly deviceId: string;
    readonly pinRevision: string;
    readonly proofHash: string;
    readonly at: Date;
    readonly expiresAt: Date;
  }): Promise<void>;
  /**
   * الدليل كما هو: البصمة بتحدد صاحبه وإصدار الـPIN وقت الإصدار.
   *
   * @param deviceId الجهاز اللي issued عليه الدليل
   * @param proofHash بصمة الدليل
   */
  findProof(deviceId: string, proofHash: string): Promise<StaffPinProofRecord | null>;
  /**
   * استهلاك ذرّي: السطر بيتحرق مرة واحدة بس، وبيتطلب إنه لسه مستهلَك ولسه داخل مدته.
   *
   * @param proof صاحب الدليل وإصدار الـPIN والبصمة ولحظة الاستهلاك
   * @param proof.userId صاحب الدليل
   * @param proof.deviceId الجهاز اللي issued عليه الدليل
   * @param proof.pinRevision إصدار الـPIN وقت الإصدار
   * @param proof.proofHash بصمة الدليل
   * @param proof.at لحظة الاستهلاك
   */
  consumeProof(proof: {
    readonly userId: string;
    readonly deviceId: string;
    readonly pinRevision: string;
    readonly proofHash: string;
    readonly at: Date;
  }): Promise<boolean>;
  /**
   * تدوير الـPIN: id جديد ورقم دائم. بيفشل لو الـPIN اتغيّر بعد ما صدر الدليل.
   *
   * @param pin صاحب الرقم وإصداره والـhash الجديد ولحظة التغيير
   * @param pin.userId صاحب الرقم
   * @param pin.pinRevision إصدار الـPIN وقت الإصدار
   * @param pin.hash الـhash الجديد
   * @param pin.at لحظة التغيير
   */
  rotatePin(pin: {
    readonly userId: string;
    readonly pinRevision: string;
    readonly hash: string;
    readonly at: Date;
  }): Promise<boolean>;
  /**
   * إيميل الاستعادة الحالي للموظفة صاحبة الدخول السارية، مقفول FOR SHARE لحد نهاية المعاملة؛
   * null لو مفيش إيميل أو الموظفة محذوفة أو صفين.
   *
   * @param userId صاحب الاعتماد
   */
  recoveryEmail(userId: string): Promise<string | null>;
  /**
   * استعادة الموظفة رقمها بنفسها بعد إثبات القناة: رقم دائم بمعرّف جديد (يبطل أي دليل تغيير قديم)
   * وبلا مانح، بشرط إن سجل دخولها لسه ACTIVE. بيرجّع معرّف الموظفة لو اتغيّر الرقم فعلاً.
   *
   * @param pin صاحب الرقم والـhash الجديد ولحظة التغيير
   * @param pin.userId صاحب الرقم
   * @param pin.hash الـhash الجديد
   * @param pin.at لحظة التغيير
   */
  recoverPin(pin: {
    readonly userId: string;
    readonly hash: string;
    readonly at: Date;
  }): Promise<string | null>;
  /** كاتب أحداث الـ outbox في نفس المعاملة: جرس المالك بيتكتب معاها من غير رقم ولا إيميل. */
  readonly outbox: OutboxWriter;
}
/** scope مأخوذ من الجهاز أو المدير المتحقق، وليس من body. */
export interface StaffPinTransactions {
  /**
   * actor لا يأخذ هوية الموظف إلا بعد إثبات PIN صحيح.
   *
   * @param companyId الشركة المتحقق منها
   * @param actor الفاعل المثبت أو null قبل الإثبات
   * @param work العمل داخل المعاملة
   */
  run<T>(
    companyId: string,
    actor: string | null,
    work: (scope: StaffPinScope) => Promise<T>,
  ): Promise<T>;
}
/** الجلسة نفسها الخاصة بـ OTP، مع فحص الجهاز والعضوية على كل إصدار. */
export interface StaffPinAuthority {
  readonly sessions: StaffSessions;
  /**
   * يشترط صلاحية الدخول الفعالة في الفرع الحالي.
   *
   * @param userId صاحب الإثبات
   * @param device الجهاز المتحقق
   */
  eligible(userId: string, device: StaffDeviceContext): Promise<boolean>;
  /**
   * يعيد فحص الجهاز قبل وبعد الإصدار.
   *
   * @param device الجهاز المتحقق
   */
  deviceValid(device: StaffDeviceContext): Promise<boolean>;
}
