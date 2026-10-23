import type { TenantWrappers, Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';

import type { PushDecision, PushDelivery, PushRevokeReason } from '../domain/push-delivery.ts';
import type { PushDeliveryRepository } from '../ports/push-delivery.repository.ts';
import { safePersistenceError } from './notification-records.ts';
import { appendPushResult } from './push-result-event.ts';

type DeliveryRow = {
  companyId: string;
  id: string;
  subscriptionId: string;
  subscriptionGeneration: number;
  userId: string;
  businessId: string | null;
  branchId: string | null;
  sourceEventId: string;
  templateKey: string;
  templateRevision: number;
  locale: 'ar' | 'en';
  safeParameters: {
    name: string;
    type: 'text' | 'number';
    value: string | number;
  }[];
  status: string;
  deadline: Date | null;
  executionId: string | null;
  sendingAt: Date | null;
  subscriptionNow: number;
  vapidKeyId: string;
  revokedAt: Date | null;
  endpoint: string | null;
  p256dh: string | null;
  auth: string | null;
  deliveryToken: string | null;
};

/**
 * جملة قراءة محاولة الدفع مع اشتراكها.
 * القاعدة: القراءة تحت RLS للشركة الواحدة، والوجهة بتتقرا مع القفل مش من جدول تاني.
 *
 * @param attemptId المحاولة المطلوبة
 * @returns الجملة جاهزة للتنفيذ
 */
export function pendingDeliveryStatement(attemptId: string): SQL {
  return sql`SELECT a.company_id AS "companyId", a.id, a.subscription_id AS "subscriptionId",
    a.subscription_generation AS "subscriptionGeneration", a.user_id AS "userId", a.business_id AS "businessId",
    a.branch_id AS "branchId", a.source_event_id AS "sourceEventId", a.template_key AS "templateKey",
    a.template_revision AS "templateRevision", a.locale, a.safe_parameters AS "safeParameters", a.status,
    a.send_deadline AS deadline, a.execution_id AS "executionId", a.sending_at AS "sendingAt",
    s.generation AS "subscriptionNow", s.vapid_key_id AS "vapidKeyId", s.revoked_at AS "revokedAt",
    s.endpoint, s.p256dh, s.auth, s.delivery_token AS "deliveryToken"
    FROM push_attempts a JOIN push_subscriptions s ON s.company_id = a.company_id AND s.id = a.subscription_id
    WHERE a.company_id = app_company_id() AND a.id = ${attemptId}`;
}

function toDelivery(row: DeliveryRow): PushDelivery {
  return {
    attempt: {
      companyId: row.companyId,
      id: row.id,
      subscriptionId: row.subscriptionId,
      subscriptionGeneration: row.subscriptionGeneration,
      userId: row.userId,
      businessId: row.businessId,
      branchId: row.branchId,
      sourceEventId: row.sourceEventId,
      templateKey: row.templateKey,
      templateRevision: row.templateRevision,
      locale: row.locale,
      safeParameters: row.safeParameters,
      status: row.status,
      deadline: row.deadline === null ? null : new Date(row.deadline),
      executionId: row.executionId,
      sendingAt: row.sendingAt === null ? null : new Date(row.sendingAt),
    },
    subscription: {
      generation: row.subscriptionNow,
      vapidKeyId: row.vapidKeyId,
      revokedAt: row.revokedAt === null ? null : new Date(row.revokedAt),
      endpoint: row.endpoint,
      p256dh: row.p256dh,
      auth: row.auth,
      deliveryToken: row.deliveryToken,
    },
  };
}

// السحب بيمسح كل الأسرار ويزوّد العدّاد، وبشرط العدّاد وقت التفويض: إجابة متأخرة لعنوان قديم
// ما تسحبش أبدًا البديل اللي تسجيل بينزّله في نفس الوقت.
async function revokeSubscription(
  tx: Tx,
  delivery: PushDelivery,
  reason: PushRevokeReason,
  now: Date,
): Promise<void> {
  await tx.execute(sql`UPDATE push_subscriptions SET revoked_at = ${now.toISOString()},
    revoked_reason = ${reason}, endpoint = NULL, p256dh = NULL, auth = NULL, delivery_token = NULL,
    generation = generation + 1, updated_at = ${now.toISOString()}
    WHERE company_id = app_company_id() AND id = ${delivery.attempt.subscriptionId}
      AND generation = ${delivery.attempt.subscriptionGeneration} AND revoked_at IS NULL`);
}

async function finish(
  tx: Tx,
  delivery: PushDelivery,
  decision: PushDecision,
  eventId: string,
  now: Date,
  pending: boolean,
): Promise<boolean> {
  const result = decision.result;
  const rows = await tx.execute(sql`UPDATE push_attempts SET status = ${result.status},
    failure_code = ${result.failureCode}, outcome_known = ${result.outcomeKnown},
    http_status = ${result.httpStatus}, finished_at = ${now.toISOString()}, updated_at = ${now.toISOString()}
    WHERE company_id = app_company_id() AND id = ${delivery.attempt.id}
      AND ${pending ? sql`status = 'PENDING'` : sql`status = 'SENDING' AND execution_id = ${delivery.attempt.executionId}`}
    RETURNING id`);
  if (rows.length === 0) return false;
  await appendPushResult(
    tx,
    {
      companyId: delivery.attempt.companyId,
      id: delivery.attempt.id,
      sourceEventId: delivery.attempt.sourceEventId,
      businessId: delivery.attempt.businessId,
      branchId: delivery.attempt.branchId,
      templateKey: delivery.attempt.templateKey,
      locale: delivery.attempt.locale,
    },
    result,
    eventId,
    now,
  );
  if (decision.revoke !== null) await revokeSubscription(tx, delivery, decision.revoke, now);
  return true;
}

/**
 * @param database الـ tenant wrappers
 * @returns مستودع تسليم الدفع: القراءة والحيازة وكتابة النتيجة، كل واحدة في معاملة مستقلة
 */
export function createPushDeliveryRepository(
  database: Pick<TenantWrappers, 'withTenant'>,
): PushDeliveryRepository {
  const run = async <T>(company: string, fn: (tx: Tx) => Promise<T>): Promise<T> => {
    try {
      return await database.withTenant(company, fn, { timeoutMs: 10_000 });
    } catch (error) {
      throw safePersistenceError(error);
    }
  };
  return {
    pending: (company, id) =>
      run(company, async (tx) => {
        const [row] = await tx.execute<DeliveryRow>(pendingDeliveryStatement(id));
        if (row === undefined || row.status !== 'PENDING') return null;
        return toDelivery(row);
      }),
    claim: (delivery, executionId, now) =>
      run(delivery.attempt.companyId, async (tx) => {
        const rows = await tx.execute(sql`UPDATE push_attempts SET status = 'SENDING',
          execution_id = ${executionId}, sending_at = ${now.toISOString()}, updated_at = ${now.toISOString()}
          WHERE company_id = app_company_id() AND id = ${delivery.attempt.id} AND status = 'PENDING'
            AND (send_deadline IS NULL OR send_deadline > ${now.toISOString()}) RETURNING id`);
        return rows.length === 1;
      }),
    finishPending: (delivery, decision, eventId, now) =>
      run(delivery.attempt.companyId, (tx) => finish(tx, delivery, decision, eventId, now, true)),
    finish: (delivery, decision, eventId, now) =>
      run(delivery.attempt.companyId, (tx) => finish(tx, delivery, decision, eventId, now, false)),
  };
}
