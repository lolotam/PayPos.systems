import type { ClaimedEvent, DeliveryOutcome, OutboxDispatcherDatabase } from '@pospay/db';
import { assertReplayBounds } from '@pospay/db';
import type { OutboxConsumer } from '../../../outbox/consumer.ts';

const PAGE_SIZE = 100;
const PAGE_LIMIT = 100;
const UNDELIVERED_LIMIT = 200;
const REPLAYABLE_EVENT_TYPES = new Set([
  'ServiceSessionRecorded',
  'ServiceSessionLinesAdded',
  'ServiceLineChanged',
  'SalaryChanged',
]);
const CONTINUABLE_FAILURE_CODES = new Set([
  'COMMISSION_EMPLOYEE_BUSINESS_MISSING',
  'COMMISSION_LINE_EVENT_INVALID',
  'COMMISSION_TIP_SALARY_INPUT_INVALID',
  'COMMISSION_BUSINESS_MISSING',
  'COMMISSION_PERIOD_CLOSED',
]);

/** حدث خارج شركة النطاق أو نوعه لا تقبله استعادة العمولات؛ الرفض يمنع تسليم حدث لمستهلك غير مقصود. */
export class CommissionReplayEventInvalidError extends Error {
  readonly code = 'COMMISSION_REPLAY_EVENT_INVALID';

  constructor() {
    super('COMMISSION_REPLAY_EVENT_INVALID');
    this.name = 'CommissionReplayEventInvalidError';
  }
}

/** نطاق الاستعادة: شركة واحدة وحد أدنى مستأنف وحد أعلى ثابت طوال التشغيل. */
export interface CommissionReplayCursor {
  readonly companyId: string;
  readonly afterId: string | null;
  readonly throughId: string | null;
}

export type CommissionReplayStatus = 'COMPLETE' | 'UNDELIVERED' | 'PAGE_LIMIT' | 'ABORTED';

/** نتيجة خالية من الحمولات؛ الهويات والأنواع والرموز وحدها تصلح لتقرير المشغّل. */
export interface CommissionReplayResult {
  readonly status: CommissionReplayStatus;
  readonly afterId: string | null;
  readonly throughId: string | null;
  readonly counts: Record<string, number>;
  readonly undelivered: { eventId: string; type: string; code: string }[];
  readonly truncated: boolean;
}

/** سبب الفشل الحقيقي لكل حدث، لأن نتيجة deliver وحدها لا تحمل رمز الخطأ المستقر. */
export type CommissionFailureCodes = Map<string, string>;

/**
 * يلتقط رمز الخطأ قبل أن يحوّله deliver إلى نتيجة عامة، ثم يعيد رميه بلا تغيير حتى تبقى معاملة الحدث ملغاة.
 *
 * @param consumer مستهلك مدخلات العمولات الأصلي
 * @param sink خريطة هوية الحدث إلى رمز الخطأ الثابت
 * @returns مستهلك بالهوية والأنواع نفسها ومعالج مغلّف لتسجيل الفشل
 */
export function recordCommissionFailureCodes(
  consumer: OutboxConsumer,
  sink: CommissionFailureCodes,
): OutboxConsumer {
  return {
    ...consumer,
    handle: async (tx, event) => {
      try {
        await consumer.handle(tx, event);
      } catch (error) {
        sink.set(event.id, failureCode(error));
        throw error;
      }
    },
  };
}

/**
 * يعيد مدخلات العمولات عبر المستهلك وحده دون تعديل نشر outbox، ويتجاوز فقط أخطاء العمل المحددة
 * حتى لا يخفي عطلًا تشغيليًا بين مئات الأحداث غير المسلّمة.
 *
 * @param deps قارئ صفحات الـ dispatcher وموصّل الأحداث وخريطة أسباب الفشل
 * @param cursor الشركة وحدود النطاق المطلوب استعادته
 * @returns موضع الاستكمال وحالة التشغيل وأعداد التسليم والأخطاء المقصودة فقط
 */
export async function runCommissionInputReplay(
  deps: {
    reader: Pick<OutboxDispatcherDatabase, 'commissionInputReplayPage'>;
    deliver: (event: ClaimedEvent) => Promise<DeliveryOutcome>;
    failures: CommissionFailureCodes;
  },
  cursor: CommissionReplayCursor,
): Promise<CommissionReplayResult> {
  assertReplayBounds(cursor.afterId, cursor.throughId);
  const companyId = cursor.companyId.toLowerCase();
  const counts: Record<string, number> = {};
  const undelivered: CommissionReplayResult['undelivered'] = [];
  let truncated = false;
  let afterId = cursor.afterId;
  let throughId = cursor.throughId;
  const result = (status: CommissionReplayStatus): CommissionReplayResult => ({
    status,
    afterId,
    throughId,
    counts,
    undelivered,
    truncated,
  });
  for (let page = 0; page < PAGE_LIMIT; page++) {
    const batch = await deps.reader.commissionInputReplayPage(companyId, afterId, throughId, PAGE_SIZE);
    if (page === 0) throughId = batch.throughId;
    if (batch.events.length === 0) return result(undelivered.length === 0 ? 'COMPLETE' : 'UNDELIVERED');
    for (const event of batch.events) {
      if (event.companyId !== companyId || !isReplayable(event))
        throw new CommissionReplayEventInvalidError();
      const outcome = await deps.deliver(event);
      if (outcome.delivered) counts[event.eventType] = (counts[event.eventType] ?? 0) + 1;
      else {
        const code = deps.failures.get(event.id);
        if (code === undefined || !CONTINUABLE_FAILURE_CODES.has(code)) return result('ABORTED');
        truncated = recordUndelivered(undelivered, event, code, truncated);
      }
      afterId = event.id;
    }
    if (batch.events.length < PAGE_SIZE)
      return result(undelivered.length === 0 ? 'COMPLETE' : 'UNDELIVERED');
  }
  return result('PAGE_LIMIT');
}

function isReplayable(event: ClaimedEvent): boolean {
  return REPLAYABLE_EVENT_TYPES.has(event.eventType);
}

function recordUndelivered(
  undelivered: CommissionReplayResult['undelivered'],
  event: ClaimedEvent,
  code: string,
  truncated: boolean,
): boolean {
  if (undelivered.length >= UNDELIVERED_LIMIT) return true;
  undelivered.push({ eventId: event.id, type: event.eventType, code });
  return truncated;
}

function failureCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return 'UNKNOWN';
}
