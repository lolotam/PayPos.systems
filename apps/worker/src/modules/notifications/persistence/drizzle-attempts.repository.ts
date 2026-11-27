import { appendAuditLog, type TenantWrappers, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { refusedResult, type Attempt, type TerminalResult } from '../domain/attempt-status.ts';
import { mayClearDestination, mayStart } from '../domain/send-deadline.ts';
import type {
  AttemptsRepository,
  ClaimVerification,
  CleanupInput,
} from '../ports/attempts.repository.ts';
import { appendResult, safePersistenceError } from './notification-records.ts';

async function readAttempt(tx: Tx, id: string): Promise<Attempt | null> {
  const [row] = await tx.execute<
    Omit<Attempt, 'identity'> & { hash: Buffer; hashKeyId: string; last3: string }
  >(sql`
    SELECT company_id AS "companyId", id, business_id AS "businessId", branch_id AS "branchId",
      source_event_id AS "sourceEventId", channel, template_key AS "templateKey", template_revision AS "templateRevision",
      locale, provider_template_name AS "providerTemplateName", recipient_phone AS phone, recipient_email AS email,
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
    identity: { hash, hashKeyId, last3: last3 ?? '', valid: true },
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
  // المعرّف المربوط بالمصالحة ما يتمسحش بنتيجة متأخرة، والنتيجة المتأخرة ما تكتبش فوق معرّف مربوط.
  const rows =
    await tx.execute(sql`UPDATE notification_attempts SET status = ${result.status}, recipient_phone = NULL, recipient_email = NULL,
    provider_message_id = COALESCE(notification_attempts.provider_message_id, ${result.providerMessageId}),
    failure_code = ${result.failureCode}, outcome_known = ${result.outcomeKnown},
    finished_at = ${now.toISOString()}, updated_at = ${now.toISOString()}
    WHERE company_id = app_company_id() AND id = ${attempt.id}
      AND ${
        pending
          ? sql`status = 'PENDING'`
          : sql`status = 'SENDING' AND execution_id = ${attempt.executionId}
        AND (notification_attempts.provider_message_id IS NULL OR ${result.providerMessageId}::text IS NULL
          OR notification_attempts.provider_message_id = ${result.providerMessageId})`
      }
    RETURNING id`);
  if (rows.length === 0) return pending ? false : recordConflict(tx, attempt, result, eventId, now);
  await appendResult(tx, attempt, result, eventId, now);
  return true;
}

async function recordConflict(
  tx: Tx,
  attempt: Attempt,
  result: TerminalResult,
  eventId: string,
  now: Date,
): Promise<boolean> {
  if (result.providerMessageId === null) return false;
  const conflict: TerminalResult = {
    status: 'FAILED',
    failureCode: 'RESPONSE_INVALID',
    outcomeKnown: false,
    providerMessageId: null,
  };
  const rows = await tx.execute(sql`
    UPDATE notification_attempts SET status = 'FAILED', recipient_phone = NULL, recipient_email = NULL,
      failure_code = 'RESPONSE_INVALID', outcome_known = false,
      finished_at = ${now.toISOString()}, updated_at = ${now.toISOString()}
    WHERE company_id = app_company_id() AND id = ${attempt.id}
      AND status = 'SENDING' AND execution_id = ${attempt.executionId}
      AND provider_message_id IS NOT NULL AND provider_message_id <> ${result.providerMessageId}
    RETURNING id`);
  if (rows.length === 0) return false;
  await appendAuditLog(tx, eventId, {
    entity: 'notification_attempt',
    entityId: attempt.id,
    action: 'provider_id.conflict',
    after: { execution_id: attempt.executionId },
  });
  await appendResult(tx, attempt, conflict, eventId, now);
  return true;
}

async function lockPendingAttempt(tx: Tx, id: string, now: Date): Promise<boolean> {
  const rows = await tx.execute<{ id: string }>(sql`
    SELECT id FROM notification_attempts
    WHERE company_id = app_company_id() AND id = ${id}
      AND status = 'PENDING' AND (send_deadline IS NULL OR send_deadline > ${now.toISOString()})
    FOR UPDATE`);
  return rows.length === 1;
}

async function claimRow(
  tx: Tx,
  attempt: Attempt,
  executionId: string,
  now: Date,
): Promise<boolean> {
  const rows =
    await tx.execute(sql`UPDATE notification_attempts SET status = 'SENDING', execution_id = ${executionId},
      sending_at = ${now.toISOString()}, updated_at = ${now.toISOString()} WHERE company_id = app_company_id() AND id = ${attempt.id}
      AND status = 'PENDING' AND (send_deadline IS NULL OR send_deadline > ${now.toISOString()}) RETURNING id`);
  return rows.length === 1;
}

async function claimWithVerification(
  tx: Tx,
  attempt: Attempt,
  executionId: string,
  now: Date,
  verification: ClaimVerification,
  onVerified: () => void,
): Promise<boolean> {
  if (!(await lockPendingAttempt(tx, attempt.id, now))) {
    onVerified();
    return false;
  }
  const txScope: Pick<TenantWrappers, 'withTenant'> = {
    withTenant: <R>(_companyId: string, fn: (innerTx: Tx) => Promise<R>) => fn(tx),
  };
  const fresh = await verification.verify(txScope);
  const claimNow = verification.decisionTime?.() ?? now;
  if (
    fresh &&
    mayStart(attempt.deadline, claimNow) &&
    verification.reservationValid !== undefined &&
    !verification.reservationValid(claimNow)
  ) {
    throw new Error('NOTIFICATION_ADMISSION_EXPIRED_DURING_VERIFY');
  }
  onVerified();
  if (!mayStart(attempt.deadline, claimNow)) {
    await record(
      tx,
      attempt,
      refusedResult('DEADLINE_EXPIRED'),
      verification.rejectEventId,
      claimNow,
      true,
    );
    return false;
  }
  if (!fresh) {
    await record(
      tx,
      attempt,
      refusedResult('DESTINATION_INVALID'),
      verification.rejectEventId,
      claimNow,
      true,
    );
    return false;
  }
  return claimRow(tx, attempt, executionId, claimNow);
}

async function runClaimWithPreClaimRetry(
  database: Pick<TenantWrappers, 'withTenant'>,
  companyId: string,
  fn: (markClaimStarted: () => void) => (tx: Tx) => Promise<boolean>,
): Promise<boolean> {
  let preClaim = true;
  try {
    return await database.withTenant(
      companyId,
      fn(() => {
        preClaim = false;
      }),
      { timeoutMs: 10_000 },
    );
  } catch (error) {
    const safe = safePersistenceError(error);
    if (preClaim) Object.assign(safe, { preClaimVerifyFailed: true });
    throw safe;
  }
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
    claim: (attempt, executionId, now, verification) =>
      runClaimWithPreClaimRetry(database, attempt.companyId, (onStarted) => (tx) => {
        if (verification === undefined) {
          onStarted();
          return claimRow(tx, attempt, executionId, now);
        }
        return claimWithVerification(tx, attempt, executionId, now, verification, onStarted);
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
    await tx.execute(sql`UPDATE notification_attempts SET recipient_phone = NULL, recipient_email = NULL, updated_at = ${now.toISOString()}
    WHERE company_id = app_company_id() AND id = ${input.attemptId} AND status = 'SENDING'
    AND execution_id = ${input.executionId} AND (recipient_phone IS NOT NULL OR recipient_email IS NOT NULL) RETURNING id`);
  if (rows.length === 0) return false;
  await appendAuditLog(tx, auditId, {
    entity: 'notification_attempt',
    entityId: input.attemptId,
    action: 'destination.cleared',
    after: { execution_id: input.executionId, execution_stopped: true },
  });
  return true;
}
