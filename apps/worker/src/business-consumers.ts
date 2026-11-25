import type { IdGenerator } from '@pospay/ids';

import {
  createCommissionInputsConsumer,
  createCommissionReminderScheduleConsumer,
} from './modules/commissions/index.ts';
import {
  createLowRatingNoticeConsumer,
  createRatingSchedulingConsumer,
} from './modules/customers/index.ts';
import {
  createDiscountApprovalNoticeConsumer,
  createDiscountSelfApprovalNoticeConsumer,
  createLateServiceSessionNoticeConsumer,
  createLineCancelNoticeConsumer,
  createPerformersChangeNoticeConsumer,
  createPriceEditNoticeConsumer,
} from './modules/orders/index.ts';
import { createStaffAccessNoticeConsumer, createStaffDocumentDefaults } from './modules/staff/index.ts';
import type { OutboxConsumer } from './outbox/consumer.ts';

type SchedulingDeps = Parameters<typeof createRatingSchedulingConsumer>[0];
type CommissionDeps = Parameters<typeof createCommissionInputsConsumer>[0];

/** ما يحتاجه تركيب مستهلكي الأعمال من main.ts: مستهلك الملفات والإشعارات ومولّد المعرّفات والساعة وقراءات الوحدات. */
export interface BusinessConsumerDeps {
  readonly files: OutboxConsumer;
  readonly notifications: OutboxConsumer | null;
  readonly inApp: OutboxConsumer | null;
  readonly newIds: () => IdGenerator;
  readonly clock: { now(): Date };
  readonly daySessions: SchedulingDeps['daySessions'];
  readonly commissions: Omit<CommissionDeps, 'ids' | 'clock'>;
}

/**
 * مستهلكو أحداث الأعمال المسجّلون في الـ worker بالترتيب الذي يستخدمه main.ts، في مكان واحد يستعمله الإقلاع واختبار تغطية الأحداث معًا،
 * فنسيان تسجيل مستهلك في الإقلاع يظهر في الاختبار. مستهلك الإشعارات الكامل يغني عن مستهلك الجرس وحده، ولا يُسجّل واحد منهما بدون الآخر.
 *
 * @param deps مستهلك الملفات والإشعارات والجرس ومولّد المعرّفات والساعة وقراءات الجلسات والعمولات
 * @returns المستهلكون بترتيب التسجيل
 */
export function businessConsumers(deps: BusinessConsumerDeps): readonly OutboxConsumer[] {
  const { newIds, clock } = deps;
  const notices = deps.notifications ?? deps.inApp;
  return [
    deps.files,
    ...(notices === null ? [] : [notices]),
    createStaffDocumentDefaults(newIds()),
    createStaffAccessNoticeConsumer(newIds(), clock),
    createLateServiceSessionNoticeConsumer(newIds(), clock),
    createPriceEditNoticeConsumer(newIds(), clock),
    createLineCancelNoticeConsumer(newIds(), clock),
    createPerformersChangeNoticeConsumer(newIds(), clock),
    createDiscountApprovalNoticeConsumer(newIds(), clock),
    createDiscountSelfApprovalNoticeConsumer(newIds(), clock),
    createLowRatingNoticeConsumer(newIds(), clock),
    createRatingSchedulingConsumer({ ids: newIds(), clock, daySessions: deps.daySessions }),
    createCommissionInputsConsumer({ ids: newIds(), clock, ...deps.commissions }),
    createCommissionReminderScheduleConsumer(),
  ];
}
