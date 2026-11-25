import { COMMISSION_INPUT_EVENT_TYPES } from '@pospay/domain';
import type { Logger } from '@pospay/observability';

import type { CommissionReminderSchedule } from '../../ports/reminder-recovery.port.ts';

/** الحدث المسلّم: هويته ونوعه وشركته، وهي كل اللي مسار التسجيل محتاجها. */
export interface CommissionReminderDeliveryEvent {
  readonly id: string;
  readonly eventType: string;
  readonly companyId: string;
}

/** نتيجة التسليم: تم، أو إعادة محاولة بسبب خطأ ثابت. */
export interface CommissionReminderDeliveryOutcome {
  readonly delivered: boolean;
  readonly error?: string;
  readonly retryInMs?: number | null;
}

/** أنماط الأحداث التي بتصلّح الجدولة عند كل تسليم (CM-57b، ADR-0061 §2). */
const REPAIR_EVENT_TYPES: readonly string[] = ['CompanyCreated', ...COMMISSION_INPUT_EVENT_TYPES];

/**
 * مسجّل التذكيرات في مسار التسليم (ADR-0061 §2): تسجيل الجدولة في Redis بيحصل **قبل**
 * علامة الاستهلاك و**بره** معاملة قاعدة البيانات. فشل الـRedis في `CompanyCreated` معناه
 * إعادة محاولة تسليم، فمفيش علامة استهلاك بتتكتب والتسجيل بيتعاد في المحاولة الجاية.
 * أحداث مدخلات العمولة بتصلّح الجدولة على التسليم (CM-57b) وفشلها ما بيمنع الإسقاط
 * في قاعدة البيانات، لأن الجدولة بتتصلّح تاني مع أول تسليم بعده.
 *
 * @param schedule الجدولة
 * @param logger  السجل
 * @returns معالج التسليم
 */
export function createCommissionReminderDelivery<
  Event extends CommissionReminderDeliveryEvent,
  Outcome extends CommissionReminderDeliveryOutcome,
>(
  schedule: CommissionReminderSchedule,
  logger: Logger,
): (event: Event, next: (event: Event) => Promise<Outcome>) => Promise<Outcome> {
  return async (event, next) => {
    if (!REPAIR_EVENT_TYPES.includes(event.eventType)) return next(event);
    const registration = await schedule.register(event.companyId);
    if (registration.registered) return next(event);
    if (event.eventType === 'CompanyCreated') {
      return {
        delivered: false,
        error: registration.error ?? 'COMMISSION_REMINDER_SCHEDULE_RETRY',
        retryInMs: 2000,
      } as Outcome;
    }
    logger.warn(
      { event: { id: event.id, type: event.eventType, companyId: event.companyId } },
      'commission reminder schedule repair failed',
    );
    return next(event);
  };
}
