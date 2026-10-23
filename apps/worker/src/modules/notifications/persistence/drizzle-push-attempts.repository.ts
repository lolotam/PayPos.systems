import { notificationResult, pushSendAuthorized } from '@pospay/contracts';
import { appendOutboxEvent, type Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';

import type { PushAttemptInput } from '../domain/push-attempt.ts';
import type { PushAttemptsRepository } from '../ports/push-attempts.repository.ts';
import { safePersistenceError } from './notification-records.ts';

/**
 * جملة قراءة اشتراكات المستخدم الحيّة.
 * القاعدة: كل اشتراك حيّ للمستخدم في الشركة دي، الأقدم الأول، والممسحوب ما بيترجعش.
 *
 * @param userId المستخدم المقصود
 * @returns الجملة جاهزة للتنفيذ
 */
export function liveSubscriptionsStatement(userId: string): SQL {
  return sql`SELECT id, locale, generation FROM push_subscriptions
    WHERE company_id = app_company_id() AND user_id = ${userId} AND revoked_at IS NULL
    ORDER BY created_at, id`;
}

async function appendAuthorized(
  tx: Tx,
  input: PushAttemptInput,
  id: string,
  eventId: string,
): Promise<void> {
  await appendOutboxEvent(tx, eventId, {
    aggregateType: 'push_attempt',
    aggregateId: id,
    eventType: 'PushSendAuthorized',
    payload: pushSendAuthorized.parse({
      company_id: input.companyId,
      attempt_id: id,
    }),
  });
}

// المحاولة اللي اتنتهت الموعد قبل ما تتفوض بتنتج فشل معروف؛ مفيش إذن إرسال ليها.
async function appendExpired(
  tx: Tx,
  input: PushAttemptInput,
  id: string,
  eventId: string,
  now: Date,
): Promise<void> {
  await appendOutboxEvent(tx, eventId, {
    aggregateType: 'push_attempt',
    aggregateId: id,
    eventType: 'NotificationFailed',
    payload: notificationResult.parse({
      company_id: input.companyId,
      attempt_id: id,
      source_event_id: input.sourceEventId,
      business_id: input.businessId,
      branch_id: input.branchId,
      channel: 'PUSH',
      template_key: input.templateKey,
      locale: input.subscription.locale,
      status: 'EXPIRED',
      occurred_at: now.toISOString(),
      evidence: 'NONE',
      failure_code: 'DEADLINE_EXPIRED',
      outcome_known: true,
    }),
  });
}

export function createPushAttemptsRepository(tx: Tx): PushAttemptsRepository {
  return {
    liveSubscriptions: async (userId) => {
      try {
        const rows = await tx.execute<{ id: string; locale: 'ar' | 'en'; generation: number }>(
          liveSubscriptionsStatement(userId),
        );
        return rows;
      } catch (error) {
        throw safePersistenceError(error);
      }
    },
    insert: async (input, decision, id, eventId, now) => {
      try {
        const expired = decision.status === 'EXPIRED';
        const failureCode = decision.status === 'EXPIRED' ? decision.failureCode : null;
        const rows = await tx.execute(sql`INSERT INTO push_attempts
          (company_id,id,subscription_id,subscription_generation,user_id,business_id,branch_id,source_event_id,
           template_key,template_revision,locale,safe_parameters,status,send_deadline,execution_id,sending_at,
           finished_at,failure_code,outcome_known,http_status,created_at,updated_at)
          VALUES (${input.companyId},${id},${input.subscription.id},${input.subscription.generation},
            ${input.userId},${input.businessId},${input.branchId},${input.sourceEventId},${input.templateKey},
            ${input.templateRevision},${input.subscription.locale},
            ${JSON.stringify(input.safeParameters)}::jsonb,${decision.status},
            ${input.deadline?.toISOString() ?? null},null,null,
            ${expired ? now.toISOString() : null},${failureCode},
            ${expired ? true : null},null,${now.toISOString()},${now.toISOString()})
          ON CONFLICT (company_id,source_event_id,subscription_id,template_key) DO NOTHING RETURNING id`);
        if (rows.length === 0) return false;
        if (expired) await appendExpired(tx, input, id, eventId, now);
        else await appendAuthorized(tx, input, id, eventId);
        return true;
      } catch (error) {
        throw safePersistenceError(error);
      }
    },
  };
}
