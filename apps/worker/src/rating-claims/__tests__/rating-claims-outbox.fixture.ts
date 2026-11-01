// أدوات المرسِل: الموصل الحقيقي وجدول الأحداث الحقيقي، وقراءات السجلات الملتزمة اللي
// بتحكم التسليم من غير ما نكتفي بقول إن المرسل مانوش.
import { createOutboxDispatcherDatabase, type ClaimedEvent } from '@pospay/db';
import { createLogger } from '@pospay/observability';

import { createDeliverer } from '../../outbox/deliver.ts';
import type { OutboxConsumer } from '../../outbox/consumer.ts';
import type { RatingClaimsWorld } from './rating-claims-world.types.ts';

/** حالة سطر الحدث في جدول الـ outbox بعد ما المرسّل يتصرف فيه. */
export interface OutboxDeliveryState {
  readonly attempts: number;
  readonly publishedAt: Date | null;
  readonly parkedAt: Date | null;
  readonly nextAttemptAt: Date;
  readonly lastError: string | null;
}

/** محاولة إشعار ملتزمة في القاعدة: هي الدليل الحقيقي إن الإذن اتمنح أو اترفض. */
export interface AttemptRow {
  readonly status: string;
  readonly failureCode: string | null;
  readonly channel: string;
  readonly templateKey: string;
}

/** المرسِل الحقيقي: بيفتح pool على دور المرسّل وبيسلّم الأحداث من جدول الـ outbox. */
export function outboxDispatcher(world: RatingClaimsWorld) {
  return createOutboxDispatcherDatabase({ url: world.base.testDb.dispatcherUrl });
}

/** الموصل الحقيقي على موديل الإشعارات: كل مستهلك بيشتغل في معاملة مستأجر. */
export function notificationDeliverer(
  world: RatingClaimsWorld,
  source: { readonly consumer: OutboxConsumer; readonly eventTypes: readonly string[] },
) {
  return createDeliverer(world.base.db, [source.consumer], createLogger('silent'), {
    knownEventTypes: source.eventTypes,
  });
}

/** سطر حدث جاهزية التقييم في جدول الـ outbox، بمعرّفه. */
export async function readyEventRow(
  world: RatingClaimsWorld,
): Promise<{ readonly id: string; readonly payload: unknown }> {
  const rows = await world.base.owner`SELECT id, payload FROM outbox
    WHERE company_id = ${world.company} AND event_type = 'RatingRequestReady'
    ORDER BY created_at, id`;
  const row = rows[0];
  if (row === undefined) throw new Error('RATING_READY_EVENT_MISSING');
  return { id: String(row['id']), payload: row['payload'] };
}

/** يحوّل وقت جاي من القاعدة إلى لحظة، سواء رجع Date أو نص. */
function instantOf(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(String(value));
}

/** حالة سطر الحدث في جدول الـ outbox: محاولات المحاولة والنشر والركن. */
export async function outboxState(
  world: RatingClaimsWorld,
  eventId: string,
): Promise<OutboxDeliveryState> {
  const rows = await world.base.owner`SELECT attempts, published_at, parked_at, next_attempt_at, last_error
    FROM outbox WHERE id = ${eventId}`;
  const row = rows[0];
  if (row === undefined) throw new Error('RATING_OUTBOX_ROW_MISSING');
  return {
    attempts: Number(row['attempts']),
    publishedAt: instantOf(row['published_at']),
    parkedAt: instantOf(row['parked_at']),
    nextAttemptAt: instantOf(row['next_attempt_at']) ?? new Date(0),
    lastError: row['last_error'] === null ? null : String(row['last_error']),
  };
}

/** محاولات الإشعار الملتزمة للحدث ده. */
export async function attemptsOf(world: RatingClaimsWorld, eventId: string): Promise<AttemptRow[]> {
  const rows = await world.base.owner`SELECT status, failure_code, channel, template_key
    FROM notification_attempts WHERE company_id = ${world.company} AND source_event_id = ${eventId}
    ORDER BY created_at, id`;
  return rows.map((row) => ({
    status: String(row['status']),
    failureCode: row['failure_code'] === null ? null : String(row['failure_code']),
    channel: String(row['channel']),
    templateKey: String(row['template_key']),
  }));
}

/** إيصالات الاستهلاك الملتزمة: كل مستهلك سجّل إن طبّق الحدث. */
export async function receiptRows(
  world: RatingClaimsWorld,
  eventId: string,
): Promise<{ readonly consumerId: string }[]> {
  const rows = await world.base.owner`SELECT consumer_id FROM consumed_events
    WHERE company_id = ${world.company} AND event_id = ${eventId}`;
  return rows.map((row) => ({ consumerId: String(row['consumer_id']) }));
}

/** المحاولات المعلّقة أو اللي في الطريق: مفيش ولا واحدة منهم المفروض تفضل موجودة. */
export async function pendingAttempts(world: RatingClaimsWorld): Promise<AttemptRow[]> {
  const rows = await world.base.owner`SELECT status, failure_code, channel, template_key
    FROM notification_attempts WHERE company_id = ${world.company} AND status IN ('PENDING', 'SENDING')`;
  return rows.map((row) => ({
    status: String(row['status']),
    failureCode: row['failure_code'] === null ? null : String(row['failure_code']),
    channel: String(row['channel']),
    templateKey: String(row['template_key']),
  }));
}

/** أحداث إذن الإرسال: وجودها معناه إن اتسمّح بإرسال خارجي. */
export async function authorizedEventIds(world: RatingClaimsWorld): Promise<string[]> {
  const rows = await world.base.owner`SELECT id FROM outbox
    WHERE company_id = ${world.company} AND event_type = 'NotificationSendAuthorized'`;
  return rows.map((row) => String(row['id']));
}

/** الحدث زي ما المرسّل بيمسكه، عشان إعادة التسليم تكون بنفس الهوية. */
export async function claimedEventOf(
  world: RatingClaimsWorld,
  eventId: string,
): Promise<ClaimedEvent> {
  const rows = await world.base.owner`SELECT company_id, id, aggregate_type, aggregate_id, event_type, payload, attempts
    FROM outbox WHERE id = ${eventId}`;
  const row = rows[0];
  if (row === undefined) throw new Error('RATING_OUTBOX_ROW_MISSING');
  return {
    companyId: String(row['company_id']),
    id: String(row['id']),
    aggregateType: String(row['aggregate_type']),
    aggregateId: String(row['aggregate_id']),
    eventType: String(row['event_type']),
    payload: row['payload'],
    attempt: Number(row['attempts']),
  };
}

/**
 * يقرّب موعد المحاولة الجاية، عشان الباك رجوع يتجرّب من غير انتظار الساعات الحقيقية.
 *
 * الباك رجوع في الإنتاج بيساعات، والاختبار بيحتاج يشوف المحاولة التانية والتالتة
 * والركن في وقت معقول، فالمختبر بيقرّب الموعد بس.
 */
export async function advanceNextAttempt(world: RatingClaimsWorld, eventId: string): Promise<void> {
  await world.base.owner`UPDATE outbox SET next_attempt_at = clock_timestamp()
    WHERE id = ${eventId} AND published_at IS NULL AND parked_at IS NULL`;
}
