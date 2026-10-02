import type { IdGenerator, PlatformWhatsappDatabase, Tx } from '@pospay/db';
import { phoneLockKey } from '@pospay/notifications';
import { sql } from 'drizzle-orm';
import type { ScrubbedWhatsappMessage } from '../domain/whatsapp-command.ts';
import type { WhatsappInboxRepository } from '../ports/whatsapp-inbox.repository.ts';

type InboxRow = { id: string; digest: string };
type NewMessage = { id: string; message: ScrubbedWhatsappMessage };

export function createWhatsappInboxRepository(
  database: PlatformWhatsappDatabase,
  ids: IdGenerator,
): WhatsappInboxRepository {
  return {
    accept: (messages, at) =>
      messages.length === 0
        ? Promise.resolve([])
        : database.withGlobal((tx) => acceptBatch({ tx, messages, at, ids })),
    confirmEnqueue: (id, at) =>
      database.withGlobal(async (tx) => {
        await tx.execute(
          sql`UPDATE public.platform_whatsapp_inbox SET enqueue_confirmed_at = ${at.toISOString()}::timestamptz
            WHERE id = ${id} AND enqueue_confirmed_at IS NULL`,
        );
      }),
  };
}

async function acceptBatch(request: {
  tx: Tx;
  messages: readonly ScrubbedWhatsappMessage[];
  at: Date;
  ids: IdGenerator;
}): Promise<readonly string[]> {
  const { tx, messages, at, ids } = request;
  const unique = new Map<string, ScrubbedWhatsappMessage>();
  for (const message of messages) {
    const digest = Buffer.from(message.digest).toString('hex');
    if (!unique.has(digest)) unique.set(digest, message);
  }
  const ordered = [...unique.values()].sort((a, b) =>
    Buffer.compare(Buffer.from(a.digest), Buffer.from(b.digest)),
  );
  const fresh = await insertInbox({ tx, messages: ordered, at, ids });
  const stops = fresh.flatMap((row) => {
    const message = unique.get(row.digest);
    if (message === undefined) throw new Error('WHATSAPP_DEDUPE_MISSING');
    return message.command === 'STOP' ? [{ id: row.id, message }] : [];
  });
  if (stops.length !== 0) await applyStops({ tx, stops, at, ids });
  // لقطة جديدة بعد INSERT تنتظر التسليم المتزامن وتجد صفه حتى لو لم يكن مرئياً قبل التعارض.
  const accepted = await tx.execute<{ id: string }>(sql`
    SELECT id FROM public.platform_whatsapp_inbox
    WHERE provider_message_digest IN (${sql.join(
      ordered.map((message) => sql`${Buffer.from(message.digest)}`),
      sql`, `,
    )})
    ORDER BY provider_message_digest`);
  if (accepted.length !== ordered.length) throw new Error('WHATSAPP_DEDUPE_MISSING');
  return accepted.map((row) => row.id);
}

function insertInbox(request: {
  tx: Tx;
  messages: readonly ScrubbedWhatsappMessage[];
  at: Date;
  ids: IdGenerator;
}) {
  const { tx, messages, at, ids } = request;
  const values = messages.map(
    (message) => sql`(
    ${ids.newId()}, ${Buffer.from(message.digest)}, ${Buffer.from(message.recipientHash)}, ${message.hashKeyId},
    ${message.command}, ${message.providerTimestamp.toISOString()}, ${at.toISOString()}, ${JSON.stringify(message.rawEvent)}::jsonb)`,
  );
  return tx.execute<InboxRow>(sql`
    INSERT INTO public.platform_whatsapp_inbox
      (id,provider_message_digest,recipient_hash,hash_key_id,command,provider_timestamp,received_at,raw_event)
    VALUES ${sql.join(values, sql`, `)}
    ON CONFLICT (provider_message_digest) DO NOTHING
    RETURNING id, encode(provider_message_digest,'hex') AS digest`);
}

async function lockPhones(tx: Tx, stops: readonly NewMessage[]): Promise<void> {
  const keys = [...new Set(stops.map((row) => phoneLockKey(row.message.recipientHash).toString()))];
  // OFFSET يمنع دمج الاستعلام الفرعي؛ الترتيب يحصل قبل تقييم دالة القفل ذات الأثر الجانبي.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(lock_key) FROM (
    SELECT lock_key FROM (VALUES ${sql.join(
      keys.map((key) => sql`(${key}::bigint)`),
      sql`, `,
    )}) AS phones(lock_key)
    ORDER BY lock_key OFFSET 0
  ) AS ordered_phones`);
}

async function applyStops(request: {
  tx: Tx;
  stops: readonly NewMessage[];
  at: Date;
  ids: IdGenerator;
}): Promise<void> {
  const { tx, stops, at, ids } = request;
  await lockPhones(tx, stops);
  const phones = new Map(
    stops.map((row) => [Buffer.from(row.message.recipientHash).toString('hex'), row.message]),
  );
  const suppressions = [...phones.values()].map(
    (message) => sql`(
    ${Buffer.from(message.recipientHash)},${message.hashKeyId},'STOP',${at.toISOString()},${at.toISOString()})`,
  );
  await tx.execute(sql`INSERT INTO public.platform_whatsapp_suppressions
    (recipient_hash,hash_key_id,source,first_opted_out_at,last_opted_out_at)
    VALUES ${sql.join(suppressions, sql`, `)}
    ON CONFLICT (recipient_hash) DO UPDATE SET source = 'STOP',
      last_opted_out_at = GREATEST(platform_whatsapp_suppressions.last_opted_out_at, EXCLUDED.last_opted_out_at)`);
  const audit = stops.map(
    ({ id, message }) => sql`(
    ${ids.newId()},${Buffer.from(message.recipientHash)},${message.hashKeyId},'STOP',${id},'OPT_OUT','RECIPIENT_STOP',${at.toISOString()})`,
  );
  await tx.execute(sql`INSERT INTO public.platform_whatsapp_audit
    (id,recipient_hash,hash_key_id,source,inbox_id,action,reason,occurred_at)
    VALUES ${sql.join(audit, sql`, `)}`);
  await tx.execute(sql`UPDATE public.platform_whatsapp_inbox SET suppression_applied_at = ${at.toISOString()}
    WHERE id IN (${sql.join(
      stops.map((row) => sql`${row.id}::uuid`),
      sql`, `,
    )})`);
}
