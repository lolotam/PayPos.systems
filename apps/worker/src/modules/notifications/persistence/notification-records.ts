import { appendOutboxEvent, type Tx } from '@pospay/db';
import { notificationResult, notificationSendAuthorized } from '@pospay/contracts';

import type { Attempt, TerminalResult } from '../domain/attempt-status.ts';

export async function appendAuthorization(
  tx: Tx,
  attempt: Attempt,
  eventId: string,
): Promise<void> {
  await appendOutboxEvent(tx, eventId, {
    aggregateType: 'notification_attempt',
    aggregateId: attempt.id,
    eventType: 'NotificationSendAuthorized',
    payload: notificationSendAuthorized.parse({
      company_id: attempt.companyId,
      attempt_id: attempt.id,
    }),
  });
}

export async function appendResult(
  tx: Tx,
  attempt: Attempt,
  result: TerminalResult,
  eventId: string,
  now: Date,
): Promise<void> {
  await appendOutboxEvent(tx, eventId, {
    aggregateType: 'notification_attempt',
    aggregateId: attempt.id,
    eventType: result.status === 'SENT' ? 'NotificationDelivered' : 'NotificationFailed',
    payload: notificationResult.parse({
      company_id: attempt.companyId,
      attempt_id: attempt.id,
      source_event_id: attempt.sourceEventId,
      business_id: attempt.businessId,
      branch_id: attempt.branchId,
      channel: attempt.channel,
      template_key: attempt.templateKey,
      locale: attempt.locale,
      status: result.status,
      occurred_at: now.toISOString(),
      evidence: result.status === 'SENT' ? 'PROVIDER_ACCEPTED' : 'NONE',
      ...(result.failureCode === null ? {} : { failure_code: result.failureCode }),
      outcome_known: result.outcomeKnown,
    }),
  });
}

export function safePersistenceError(error: unknown): Error {
  const diagnostic = error as {
    code?: unknown;
    constraint_name?: unknown;
    cause?: { code?: unknown; constraint_name?: unknown };
  };
  const code = diagnostic.cause?.code ?? diagnostic.code;
  const constraint = diagnostic.cause?.constraint_name ?? diagnostic.constraint_name;
  const state = typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
  const check =
    typeof constraint === 'string' && /^notification_attempts_[a-z_]+$/.test(constraint)
      ? constraint
      : undefined;
  const name =
    error instanceof Error && error.name === 'CommitOutcomeUnknownError'
      ? error.name
      : 'NotificationPersistenceError';
  return Object.assign(
    new Error(['NOTIFICATION_PERSISTENCE_FAILED', state, check].filter(Boolean).join(':')),
    { name, code: state },
  );
}
