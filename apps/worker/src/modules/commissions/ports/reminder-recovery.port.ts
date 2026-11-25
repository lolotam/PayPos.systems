import type {
  ReminderLease,
  ReminderSentinel,
  ReminderSlot,
} from '../domain/reminder-recovery.ts';

/** لقطة Redis الذرّية: الشهادة والإيجار ومعرّف تشغيل الخادم في MULTI/EXEC واحد. */
export interface ReminderRecoverySnapshot {
  readonly sentinel: ReminderSentinel | null;
  readonly lease: ReminderLease | null;
  readonly serverRunId: string | null;
}

/** لقطة الفحص: اللقطة الذرّية مع وجود جدولات الشركات الموقوفة في نفس العملية. */
export interface ReminderRecoveryProbe extends ReminderRecoverySnapshot {
  readonly schedulers: readonly boolean[];
}

/** مدخلات النشر: الشهادة الجديدة ومفتاح المسار ومفتاح الإيقاع. */
export interface ReminderPublishInput {
  readonly passId: string;
  readonly incidentId: string | null;
  readonly runId: string;
  readonly release: string;
  readonly cutoff: string;
  readonly cutoffSeq: string;
}

/** مدخلات حجز الإيجار: معرّف المسار ومعرّف تشغيل Redis والحادثة (لو اتعرفت) وعمر المفتاح. */
export interface ReminderLeaseAcquireInput {
  readonly passId: string;
  readonly runId: string;
  readonly incidentId: string | null;
  readonly ttlSeconds: number;
}

/** مدخلات كتابة سجل الإيقاع: السجل الجديد تحت فحص ملكية المسار. */
export interface ReminderSlotWriteInput {
  readonly passId: string;
  readonly slot: ReminderSlot;
  readonly ttlSeconds: number;
}

/**
 * واجهة استعادة الجدولة على Redis (ADR-0061 §4): كل كتابة مشتركة مضمونة بمقارنة
 * `pass_id` في سكربت واحد، ومفيش كتابة أو حذف غير مضمون.
 */
export interface ReminderRecoveryStore {
  /** يحجز حق الاستعادة (NX)؛ الملكية مؤقت بمفتاح واحد (الإيجار). */
  acquire: (input: ReminderLeaseAcquireInput) => Promise<boolean>;
  /** يجدّد الإيجار تحت فحص `pass_id`. */
  renew: (passId: string, ttlSeconds: number) => Promise<boolean>;
  /** يحرّر الإيجار تحت فحص `pass_id`. */
  release: (passId: string) => Promise<boolean>;
  /** يسجّل الحادثة المتبنّاة في الإيجار تحت فحص `pass_id`. */
  setIncident: (passId: string, incidentId: string, ttlSeconds: number) => Promise<boolean>;
  /** لقطة ذرّية للشهادة والإيجار ومعرّف تشغيل الخادم. */
  snapshot: () => Promise<ReminderRecoverySnapshot>;
  /** لقطة ذرّية واحدة فيها الشهادة والإيجار ومعرّف التشغيل ووجود جدولات الشركات. */
  probe: (schedulerKeys: readonly string[]) => Promise<ReminderRecoveryProbe>;
  /** يقرأ سجل الإيقاع. */
  readSlot: () => Promise<ReminderSlot | null>;
  /** يكتب سجل الإيقاع تحت فحص ملكية المسار. */
  writeSlot: (input: ReminderSlotWriteInput) => Promise<boolean>;
  /** يبطل الشهادة تحت فحص ملكية المسار. */
  invalidateSentinel: (passId: string) => Promise<boolean>;
  /** ينشر الشهادة ويحذف الإيجار وسجل الإيقاع في سكربت واحد. */
  publish: (input: ReminderPublishInput) => Promise<boolean>;
  /** معرّف تشغيل Redis الحالي. */
  serverRunId: () => Promise<string | null>;
}

/** نتيجة تسجيل الجدولة: نجحت، أو سبب التعذّر. */
export interface ScheduleRegistration {
  readonly registered: boolean;
  readonly error?: string;
}

/** الجدولة على مستوى الشركة: تسجيل الجدولة ووجودها في Redis. */
export interface CommissionReminderSchedule {
  /** يسجّل جدولة الشركة (idempotent)؛ الفشل معناه إعادة محاولة. */
  register: (companyId: string) => Promise<ScheduleRegistration>;
  /** هل جدولة الشركة موجودة في Redis؟ */
  exists: (companyId: string) => Promise<boolean>;
  /** هل كل الجداول المعطاة موجودة؟ */
  existsAll: (companyIds: readonly string[]) => Promise<readonly boolean[]>;
  /** مفاتيح جداول الشركات في Redis: عشان فحص وجودها يكون في نفس العملية الذرّية. */
  schedulerKeys: (companyIds: readonly string[]) => readonly string[];
}

/** عتبة الاستعادة: وقت PostgreSQL وسور الرقم التسلسلي وقت أخذه. */
export interface RecoveryCutoff {
  readonly cutoff: Date;
  readonly maxOutboxSeq: string;
}

/** حادثة مفتوحة في سجل الأعلام التشغيلية. */
export interface RecoveryFlag {
  readonly id: string;
  readonly code: string;
  readonly raisedAt: Date;
}

/** صفحة أحداث `CompanyCreated` الموقوفة بعد العتبة. */
export interface ParkedCompanyPage {
  readonly companyIds: readonly string[];
  readonly overflow: boolean;
  readonly dbNow: Date;
}

/**
 * قارئ الاستعادة على واجهة المرسّل (ADR-0061 §1): قراءة معرّفات الشركات، ورفع العلامات،
 * وقراءتها، وقراءة الأحداث الموقوفة. مفيش عميل خام ولا أي طريق تاني للقاعدة.
 */
export interface ReminderRecoveryReaders {
  /** يقرأ العتبة وسور الرقم التسلسلي وقت أخذها. */
  sampleReminderRecoveryCutoff: () => Promise<RecoveryCutoff>;
  /** يقرأ صفحة من معرّفات الشركات الحيّة بالترتيب التصاعدي. */
  companyIdPage: (afterId: string | null, pageSize: number) => Promise<readonly string[]>;
  /** يرفع علامة مفتوحة؛ لو في علامة مفتوحة لنفس الكود بيرجع `raised: false` من غير صف جديد. */
  raiseRecoveryFlag: (
    id: string,
    code: string,
  ) => Promise<{ raised: boolean; raisedAt: Date | null }>;
  /** يقرأ كل العلامات المفتوحة، الأقدم أول. */
  openRecoveryFlags: () => Promise<readonly RecoveryFlag[]>;
  /** يقرأ أحداث `CompanyCreated` الموقوفة بعد العتبة، مع سور الرقم التسلسلي. */
  parkedCompanyCreatedAfter: (cutoff: Date, cutoffSeq: string) => Promise<ParkedCompanyPage>;
}

/** مدخلات مسح الحادثة: الحادثة ومعرّف تشغيل Redis ومعرّف المسار وعدد الشركات ومعرّف التدقيق. */
export interface RecoveryClearInput {
  readonly incidentId: string;
  readonly runId: string;
  readonly passId: string;
  readonly companiesRebuilt: number;
  readonly auditId: string;
}
