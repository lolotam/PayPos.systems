import { RATING_CLAIMS_DISCOVERY, ratingClaimsJob } from '@pospay/contracts';
import type { ClaimedEvent, DeliveryOutcome, OutboxDispatcherDatabase } from '@pospay/db';
import { assertReplayBounds } from '@pospay/db';
import { RATING_CLAIMS_TRIGGERS } from './rating-claims.processor.ts';
import type { RatingClaimsRegistrar } from './rating-claims.registration.ts';
import { validRatingClaimsDiscovery } from './rating-claims-discovery.ts';

/** موضع الاستعادة المعلن: لا يخزن شيئًا في outbox ولا يعيد كتابة حالة الإرسال. */
export interface RatingClaimsReplayCursor {
  readonly companyId: string;
  readonly afterId: string | null;
  readonly throughId: string | null;
}

/**
 * يعيد تسجيل شركة من أحداثها المحفوظة، ثم يمرر الزيارات إلى مستهلك الجدولة وحده.
 * لا يبني عامل مطالبة، ولا يعيد حدث RatingRequestReady أو نتيجة إشعار.
 * تقدم المؤشر بعد نجاح الحدث فقط، والإعادة تستخدم هويته الأصلية لحفظ dedupe.
 *
 * @param deps قارئ المرسل المقيد ومسجل BullMQ ومستهلك الجدولة
 * @param cursor الشركة وحدود الصفحة السابقة
 * @returns موضع الاستكمال وحالة اكتمال الدفعة والأعداد دون الحمولة
 */
export async function recoverRatingClaims(
  deps: {
    reader: Pick<OutboxDispatcherDatabase, 'ratingClaimsReplayPage'>;
    registrar: Pick<RatingClaimsRegistrar, 'ensureRegistered'>;
    deliverSchedules: (event: ClaimedEvent) => Promise<DeliveryOutcome>;
  },
  cursor: RatingClaimsReplayCursor,
) {
  ratingClaimsJob.parse({ companyId: cursor.companyId });
  assertReplayBounds(cursor.afterId, cursor.throughId);
  const companyId = cursor.companyId.toLowerCase();
  let afterId = cursor.afterId;
  let throughId = cursor.throughId;
  let replayed = 0;
  // دفعة المشغّل محدودة؛ الموضع الصريح يسمح بالاستكمال دون إعادة صفحات ناجحة.
  for (let page = 0; page < 100; page++) {
    const batch = await deps.reader.ratingClaimsReplayPage(companyId, afterId, throughId, 100);
    throughId = batch.throughId;
    if (batch.events.length === 0) return { complete: true, afterId, throughId, replayed };
    for (const event of batch.events) {
      if (event.companyId !== companyId || !isReplayable(event))
        throw new Error('RATING_CLAIMS_REPLAY_EVENT_INVALID');
      await deps.registrar.ensureRegistered(event.companyId);
      if (event.eventType !== RATING_CLAIMS_DISCOVERY) {
        const outcome = await deps.deliverSchedules(event);
        if (!outcome.delivered) return { complete: false, afterId, throughId, replayed };
      }
      afterId = event.id;
      replayed++;
    }
  }
  return { complete: false, afterId, throughId, replayed };
}

function isReplayable(event: ClaimedEvent): boolean {
  if (event.eventType === RATING_CLAIMS_DISCOVERY) return validRatingClaimsDiscovery(event);
  return RATING_CLAIMS_TRIGGERS.includes(event.eventType);
}
