import type { Logger } from '@pospay/observability';

import type { IdGenerator } from '../../ports/commission-line-projection.port.ts';
import type {
  CommissionReminderSchedule,
  RecoveryClearInput,
  ReminderRecoveryReaders,
  ReminderRecoveryStore,
} from '../../ports/reminder-recovery.port.ts';
import type { RecoveryLeaseKeeper } from './recovery-lease-keeper.ts';

/** ساعة العامل: مصدر محقون عشان حدود المسار تبقى قابلة للاختبار. */
export interface RecoveryClock {
  /** يرجع اللحظة الحالية. */
  now(): Date;
}

/** حادثة فتحها سجل الأعلام التشغيلية. */
export interface RecoveryIncident {
  readonly id: string;
  readonly raisedAt: Date;
}

/** نتيجة المسار الواحد. */
export type RecoveryOutcome =
  /** نُشرّت شهادة جديدة و(لو كان في حادثة) اتمسحت. */
  | 'PUBLISHED'
  /** مفيش سبب نشيط: مفيش حاجة تتعمل. */
  | 'NOTHING_NEEDED'
  /** مسار تاني يملك الإيجار. */
  | 'BUSY'
  /** الفتحة دي اتجرّبت قبل كده في الحادثة دي. */
  | 'REFUSED_PACING'
  /** الحادثة اللي المشغّل سمّاها مش مفتوحة. */
  | 'STALE_OPERATOR_INCIDENT'
  /** المسار وقف قبل إتمام النشر (ولو تم المسح قبل فشل النشر تظل الشهادة مبطلة لإعادة التصديق). */
  | 'FAILED';

/** نتيجة تفصيلية للمسار. */
export interface RecoveryResult {
  readonly outcome: RecoveryOutcome;
  readonly passId: string;
  readonly companies: number;
  readonly rebuilt: number;
  readonly incidentId: string | null;
}

/** سبب بدء المسار. */
export type RecoveryMode = 'STARTUP' | 'DETECT' | 'OPERATOR';

/** مدخلات المسار. */
export interface RecoverCommissionRemindersInput {
  readonly mode: RecoveryMode;
  /** الحادثة المسمّاة: إلزامية في وضع المشغّل. */
  readonly incidentId?: string;
}

/** مهل العمليات: كلها اختيارية وليها قيم ADR-0061 §4 الافتراضية. */
export interface RecoveryTimeouts {
  /** مهلة قراءة صفحة الشركات وفحص وجود جدولاتها (الافتراضي 30 ثانية). */
  readonly pageDeadlineMs?: number;
  /** مهلة تسجيل جدولة شركة واحدة (الافتراضي 10 ثوانٍ). */
  readonly upsertDeadlineMs?: number;
  /** أطول فترة بلا تقدّم (صفحة رجعت أو تسجيل خلص) قبل إنهاء المسار (الافتراضي 90 ثانية). */
  readonly maxIdleMs?: number;
}

/** كل ما المسار يحتاجه: قارئ المرسّل ومتجر Redis والجدولة والساعة والمولّد والسجل. */
export interface RecoverCommissionRemindersDeps extends RecoveryTimeouts {
  readonly database: ReminderRecoveryReaders;
  readonly store: ReminderRecoveryStore;
  readonly schedule: CommissionReminderSchedule;
  readonly ids: IdGenerator;
  readonly clock: RecoveryClock;
  readonly logger: Logger;
  readonly release: string;
  /**
   * مسح الحادثة: العامل بيستعمل دالة الـdefiner بهوية النظام الثابتة، والمشغّل
   * بيستعمل معاملته هوةً بهويته الخاصة (ADR-0061 §3 و§7).
   */
  readonly clearIncident: (input: RecoveryClearInput) => Promise<boolean>;
}

/** سياق المسار بعد حجز المفتاح؛ `incident` بتتحدّد تحت الملكية وممكن تتبنّى وسط إعادة البناء. */
export interface PassContext {
  readonly passId: string;
  readonly runId: string;
  readonly mode: RecoveryMode;
  readonly keeper: RecoveryLeaseKeeper;
  incident: RecoveryIncident | null;
}
