import type { IdGenerator, PlatformEmailDatabase } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { EmailFeedbackInboxRepository } from '../ports/email-feedback.repository.ts';

/**
 * The inbox adapter: one row per provider event, keyed by its permanent digest, and the enqueue
 * confirmation. It never sees an address — the envelope it stores is scrubbed by the intake.
 */
export function createEmailFeedbackInboxRepository(
  database: PlatformEmailDatabase,
  ids: IdGenerator,
): EmailFeedbackInboxRepository {
  return {
    accept: (event, at) =>
      database.withGlobal(async (tx) => {
        const inserted = await tx.execute<{ id: string }>(sql`
          INSERT INTO public.platform_email_feedback_inbox
            (id,provider_event_digest,provider_email_id,event_type,bounce_class,provider_timestamp,received_at,raw_event)
          VALUES (${ids.newId()},${event.digest},${event.emailId},${event.type},${event.bounceClass},
            ${event.providerTimestamp.toISOString()},${at.toISOString()},${JSON.stringify(event.envelope)}::jsonb)
          ON CONFLICT (provider_event_digest) DO NOTHING
          RETURNING id`);
        if (inserted.length === 1) return { id: inserted[0]?.id ?? '', inserted: true };
        const existing = await tx.execute<{ id: string }>(sql`
          SELECT id FROM public.platform_email_feedback_inbox WHERE provider_event_digest = ${event.digest}`);
        const row = existing[0];
        if (row === undefined) throw new Error('EMAIL_FEEDBACK_ROW_MISSING');
        return { id: row.id, inserted: false };
      }),
    confirmEnqueue: (id, at) =>
      database.withGlobal(async (tx) => {
        await tx.execute(
          sql`UPDATE public.platform_email_feedback_inbox SET enqueue_confirmed_at = ${at.toISOString()}::timestamptz
            WHERE id = ${id} AND enqueue_confirmed_at IS NULL`,
        );
      }),
  };
}
