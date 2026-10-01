import { appendAuditLog, type TenantWrappers, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import type { Attempt, TerminalResult } from '../domain/attempt-status.ts';
import { mayClearDestination } from '../domain/send-deadline.ts';
import type { AttemptsRepository, CleanupInput } from '../ports/attempts.repository.ts';
import { appendResult, safePersistenceError } from './notification-records.ts';

async function readAttempt(tx: Tx, id: string): Promise<Attempt | null> {
  const [row] = await tx.execute<
    Omit<Attempt, 'identity'> & { hash: Buffer; hashKeyId: string; last3: string }
  >(sql`
    SELECT company_id AS "companyId", id, business_id AS "businessId", branch_id AS "branchId",
      source_event_id AS "sourceEventId", channel, template_key AS "templateKey", template_revision AS "templateRevision",
      locale, provider_template_name AS "providerTemplateName", recipient_phone AS phone,
      recipient_hash AS hash, hash_key_id AS "hashKeyId", phone_last3 AS last3, safe_parameters AS "safeParameters",
      status, authorized_at AS "authorizedAt", send_deadline AS deadline, execution_id AS "executionId", sending_at AS "sendingAt"
    FROM notification_attempts WHERE company_id = app_company_id() AND id = ${id}`);
  if (row === undefined) return null;
  const { hash, hashKeyId, last3, ...attempt } = row;
  return {
    ...attempt,
    authorizedAt: new Date(attempt.authorizedAt),
    deadline: attempt.deadline === null ? null : new Date(attempt.deadline),
    sendingAt: attempt.sendingAt === null ? null : new Date(attempt.sendingAt),
    identity: { hash, hashKeyId, last3, valid: true },
  };
}

async function record(
  tx: Tx,
  attempt: Attempt,
  result: TerminalResult,
  eventId: string,
  now: Date,
  pending: boolean,
): Promise<boolean> {
  const rows =
    await tx.execute(sql`UPDATE notification_attempts SET status = ${result.status}, recipient_phone = NULL,
    provider_message_id = ${result.providerMessageId}, failure_code = ${result.failureCode}, outcome_known = ${result.outcomeKnown},
    finished_at = ${now.toISOString()}, updated_at = ${now.toISOString()}
    WHERE company_id = app_company_id() AND id = ${attempt.id}
      AND ${pending ? sql`status = 'PENDING'` : sql`status = 'SENDING' AND execution_id = ${attempt.executionId}`}
    RETURNING id`);
  if (rows.length === 0) return false;
  await appendResult(tx, attempt, result, eventId, now);
  return true;
}

export function createAttemptsRepository(
  database: Pick<TenantWrappers, 'withTenant'>,
): AttemptsRepository {
  const run = async <T>(
    company: string,
    fn: (tx: Tx) => Promise<T>,
    userId?: string,
  ): Promise<T> => {
    try {
      return await database.withTenant(company, fn, {
        timeoutMs: 10_000,
        ...(userId === undefined ? {} : { userId }),
      });
    } catch (error) {
      throw safePersistenceError(error);
    }
  };
  return {
    pending: (company, id) =>
      run(company, async (tx) => {
        const attempt = await readAttempt(tx, id);
        return attempt?.status === 'PENDING' ? attempt : null;
      }),
    claim: (attempt, executionId, now) =>
      run(attempt.companyId, async (tx) => {
        const rows =
          await tx.execute(sql`UPDATE notification_attempts SET status = 'SENDING', execution_id = ${executionId},
        sending_at = ${now.toISOString()}, updated_at = ${now.toISOString()} WHERE company_id = app_company_id() AND id = ${attempt.id}
        AND status = 'PENDING' AND (send_deadline IS NULL OR send_deadline > ${now.toISOString()}) RETURNING id`);
        return rows.length === 1;
      }),
    finishPending: (attempt, result, eventId, now) =>
      run(attempt.companyId, (tx) => record(tx, attempt, result, eventId, now, true)),
    finish: (attempt, result, eventId, now) =>
      run(attempt.companyId, (tx) => record(tx, attempt, result, eventId, now, false)),
    clearAbandoned: (input, auditId, now) =>
      run(input.companyId, (tx) => clearAbandoned(tx, input, auditId, now), input.operatorId),
  };
}

async function clearAbandoned(
  tx: Tx,
  input: CleanupInput,
  auditId: string,
  now: Date,
): Promise<boolean> {
  const attempt = await readAttempt(tx, input.attemptId);
  if (
    attempt === null ||
    attempt.status !== 'SENDING' ||
    attempt.executionId !== input.executionId ||
    !mayClearDestination(attempt.sendingAt, now, input.executionStopped)
  )
    return false;
  const rows =
    await tx.execute(sql`UPDATE notification_attempts SET recipient_phone = NULL, updated_at = ${now.toISOString()}
    WHERE company_id = app_company_id() AND id = ${input.attemptId} AND status = 'SENDING'
    AND execution_id = ${input.executionId} AND recipient_phone IS NOT NULL RETURNING id`);
  if (rows.length === 0) return false;
  await appendAuditLog(tx, auditId, {
    entity: 'notification_attempt',
    entityId: input.attemptId,
    action: 'destination.cleared',
    after: { execution_id: input.executionId, execution_stopped: true },
  });
  return true;
}
