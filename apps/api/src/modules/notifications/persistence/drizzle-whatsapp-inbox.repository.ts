import type { IdGenerator, PlatformWhatsappDatabase, Tx } from '@pospay/db';
import { phoneLockKey } from '@pospay/notifications';
import { sql } from 'drizzle-orm';
import type { ScrubbedWhatsappMessage } from '../domain/whatsapp-command.ts';
import type { WhatsappInboxRepository } from '../ports/whatsapp-inbox.repository.ts';

export function createWhatsappInboxRepository(
  database: PlatformWhatsappDatabase,
  ids: IdGenerator,
): WhatsappInboxRepository {
  return {
    accept: (messages, at) =>
      database.withGlobal(async (tx) => {
        const ordered = [...messages].sort((a, b) =>
          Buffer.compare(Buffer.from(a.digest), Buffer.from(b.digest)),
        );
        const accepted: string[] = [];
        const fresh: { id: string; message: ScrubbedWhatsappMessage }[] = [];
        for (const message of ordered) {
          const [row] = await tx.execute<{ id: string }>(sql`
          INSERT INTO public.platform_whatsapp_inbox
            (id, provider_message_digest, recipient_hash, hash_key_id, command, provider_timestamp, received_at, raw_event)
          VALUES (${ids.newId()}, ${Buffer.from(message.digest)}, ${Buffer.from(message.recipientHash)}, ${message.hashKeyId},
            ${message.command}, ${message.providerTimestamp.toISOString()}, ${at.toISOString()}, ${JSON.stringify(message.rawEvent)}::jsonb)
          ON CONFLICT (provider_message_digest) DO NOTHING RETURNING id`);
          if (row !== undefined) {
            fresh.push({ id: row.id, message });
            accepted.push(row.id);
          } else {
            const [existing] = await tx.execute<{
              id: string;
            }>(sql`SELECT id FROM public.platform_whatsapp_inbox
            WHERE provider_message_digest = ${Buffer.from(message.digest)}`);
            if (existing === undefined) throw new Error('WHATSAPP_DEDUPE_MISSING');
            accepted.push(existing.id);
          }
        }
        const locks = [
          ...new Set(
            fresh
              .filter((r) => r.message.command === 'STOP')
              .map((r) => phoneLockKey(r.message.recipientHash).toString()),
          ),
        ].sort();
        for (const key of locks)
          await tx.execute(sql`SELECT pg_advisory_xact_lock(${key}::bigint)`);
        for (const row of fresh)
          if (row.message.command === 'STOP')
            await applyStop({ tx, id: row.id, message: row.message, at, auditId: ids.newId() });
        return [...new Set(accepted)];
      }),
    confirmEnqueue: (id, at) =>
      database.withGlobal(async (tx) => {
        await tx.execute(
          sql`UPDATE public.platform_whatsapp_inbox SET enqueue_confirmed_at = ${at.toISOString()}::timestamptz
            WHERE id = ${id} AND enqueue_confirmed_at IS NULL`,
        );
      }),
  };
}

async function applyStop(request: {
  tx: Tx;
  id: string;
  message: ScrubbedWhatsappMessage;
  at: Date;
  auditId: string;
}): Promise<void> {
  const { tx, id, message, at, auditId } = request;
  const hash = Buffer.from(message.recipientHash);
  await tx.execute(sql`INSERT INTO public.platform_whatsapp_suppressions
    (recipient_hash,hash_key_id,source,first_opted_out_at,last_opted_out_at)
    VALUES (${hash},${message.hashKeyId},'STOP',${at.toISOString()},${at.toISOString()})
    ON CONFLICT (recipient_hash) DO UPDATE SET source = 'STOP',
      last_opted_out_at = GREATEST(platform_whatsapp_suppressions.last_opted_out_at, EXCLUDED.last_opted_out_at)`);
  await tx.execute(sql`INSERT INTO public.platform_whatsapp_audit
    (id,recipient_hash,hash_key_id,source,inbox_id,action,reason,occurred_at)
    VALUES (${auditId},${hash},${message.hashKeyId},'STOP',${id},'OPT_OUT','RECIPIENT_STOP',${at.toISOString()})`);
  await tx.execute(
    sql`UPDATE public.platform_whatsapp_inbox SET suppression_applied_at = ${at.toISOString()} WHERE id = ${id}`,
  );
}
