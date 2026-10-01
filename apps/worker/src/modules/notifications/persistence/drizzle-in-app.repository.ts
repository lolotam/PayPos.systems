import { appendOutboxEvent, type Tx } from '@pospay/db';
import { notificationResult } from '@pospay/contracts';
import { sql } from 'drizzle-orm';

import type { InAppRepository } from '../ports/in-app.repository.ts';
import { safePersistenceError } from './notification-records.ts';

export function createInAppRepository(tx: Tx): InAppRepository {
  return {
    insert: async (input, id, eventId, now) => {
      try {
        const rows = await tx.execute(sql`INSERT INTO in_app_notifications
          (company_id,id,recipient_user_id,business_id,branch_id,source_event_id,
           template_key,template_revision,locale,safe_parameters,created_at)
          VALUES (${input.companyId},${id},${input.recipientUserId},${input.businessId},${input.branchId},
            ${input.sourceEventId},${input.templateKey},${input.templateRevision},${input.locale},
            ${JSON.stringify(input.safeParameters)}::jsonb,${now.toISOString()})
          ON CONFLICT (company_id,source_event_id,recipient_user_id,template_key) DO NOTHING RETURNING id`);
        if (rows.length === 0) return false;
        await appendOutboxEvent(tx, eventId, {
          aggregateType: 'in_app_notification',
          aggregateId: id,
          eventType: 'NotificationDelivered',
          payload: notificationResult.parse({
            company_id: input.companyId,
            attempt_id: id,
            source_event_id: input.sourceEventId,
            recipient_user_id: input.recipientUserId,
            business_id: input.businessId,
            branch_id: input.branchId,
            channel: 'IN_APP',
            template_key: input.templateKey,
            locale: input.locale,
            status: 'SENT',
            occurred_at: now.toISOString(),
            evidence: 'IN_APP_STORED',
            outcome_known: true,
          }),
        });
        return true;
      } catch (error) {
        throw safePersistenceError(error);
      }
    },
  };
}
