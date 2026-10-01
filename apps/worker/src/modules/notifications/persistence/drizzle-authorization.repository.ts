import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { isTerminal, refusedResult, type Attempt } from '../domain/attempt-status.ts';
import type { AuthorizationRepository } from '../ports/attempts.repository.ts';
import { lockPhone } from './phone-lock.ts';
import { appendAuthorization, appendResult, safePersistenceError } from './notification-records.ts';

export function createAuthorizationRepository(tx: Tx): AuthorizationRepository {
  return {
    lock: (hash) => lockPhone(tx, hash),
    insert: async (input, decision, id, eventId, now) => {
      const terminal = isTerminal(decision.status);
      const attempt: Attempt = {
        ...input,
        id,
        locale: decision.locale,
        status: decision.status,
        phone: terminal ? null : input.phone,
        authorizedAt: now,
        executionId: null,
        sendingAt: null,
      };
      try {
        const rows = await tx.execute(sql`INSERT INTO notification_attempts (
          company_id, id, business_id, branch_id, source_event_id, channel, template_key, template_revision,
          locale, provider_template_name, recipient_phone, recipient_hash, hash_key_id, phone_last3,
          safe_parameters, status, authorized_at, send_deadline, finished_at, failure_code, outcome_known, created_at, updated_at
        ) VALUES (${input.companyId}, ${id}, ${input.businessId}, ${input.branchId}, ${input.sourceEventId},
          ${input.channel}, ${input.templateKey}, ${input.templateRevision}, ${decision.locale},
          ${input.providerTemplateName}, ${attempt.phone}, ${Buffer.from(input.identity.hash)}, ${input.identity.hashKeyId},
          ${input.identity.last3}, ${JSON.stringify(input.safeParameters)}::jsonb, ${decision.status}, ${now.toISOString()},
          ${input.deadline?.toISOString() ?? null}, ${terminal ? now.toISOString() : null}, ${decision.failureCode}, ${terminal ? true : null}, ${now.toISOString()}, ${now.toISOString()})
          ON CONFLICT (company_id, source_event_id, channel, recipient_hash, template_key) DO NOTHING RETURNING id`);
        if (rows.length === 0) return false;
        if (decision.failureCode === null) await appendAuthorization(tx, attempt, eventId);
        else await appendResult(tx, attempt, refusedResult(decision.failureCode), eventId, now);
        return true;
      } catch (error) {
        throw safePersistenceError(error);
      }
    },
  };
}
