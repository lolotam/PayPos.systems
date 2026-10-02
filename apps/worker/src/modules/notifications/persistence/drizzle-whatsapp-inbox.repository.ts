import type { PlatformWhatsappDatabase } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { WhatsappInboxRepository } from '../ports/whatsapp-inbox.repository.ts';

export function createWhatsappInboxRepository(
  database: PlatformWhatsappDatabase,
): WhatsappInboxRepository {
  return {
    unfinished: () =>
      database.withGlobal(async (tx) => {
        const rows = await tx.execute<{
          id: string;
        }>(sql`SELECT id FROM public.platform_whatsapp_inbox
        WHERE enqueue_confirmed_at IS NULL OR processed_at IS NULL ORDER BY received_at,id LIMIT 100`);
        return rows.map((row) => row.id);
      }),
    confirmEnqueue: (id, at) =>
      database.withGlobal(async (tx) => {
        await tx.execute(
          sql`UPDATE public.platform_whatsapp_inbox SET enqueue_confirmed_at = ${at.toISOString()}::timestamptz
            WHERE id = ${id} AND enqueue_confirmed_at IS NULL`,
        );
      }),
    process: (id, at) =>
      database.withGlobal(async (tx) => {
        const rows =
          await tx.execute(sql`UPDATE public.platform_whatsapp_inbox SET processed_at = ${at.toISOString()}
        WHERE id = ${id} AND processed_at IS NULL AND (command = 'OTHER' OR suppression_applied_at IS NOT NULL) RETURNING id`);
        if (rows.length === 0) {
          const [existing] = await tx.execute<{ processed_at: Date | null }>(
            sql`SELECT processed_at FROM public.platform_whatsapp_inbox WHERE id = ${id}`,
          );
          if (existing?.processed_at == null) throw new Error('WHATSAPP_INBOX_NOT_PROCESSABLE');
        }
      }),
    clearPayloads: (cutoff) => drainPayloads(database, cutoff),
  };
}

async function drainPayloads(database: PlatformWhatsappDatabase, cutoff: Date): Promise<number> {
  let cleared = 0;
  for (let batch = 0; batch < 100; batch++) {
    const count = await database.withGlobal(async (tx) => {
      const rows = await tx.execute(sql`WITH batch AS (
        SELECT id FROM public.platform_whatsapp_inbox WHERE raw_event IS NOT NULL
          AND received_at <= ${cutoff.toISOString()} ORDER BY received_at,id LIMIT 100 FOR UPDATE SKIP LOCKED)
        UPDATE public.platform_whatsapp_inbox SET raw_event = NULL WHERE id IN (SELECT id FROM batch) RETURNING id`);
      return rows.length;
    });
    cleared += count;
    if (count < 100) break;
  }
  return cleared;
}
