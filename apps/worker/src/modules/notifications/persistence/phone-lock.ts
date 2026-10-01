import type { Tx } from '@pospay/db';
import { phoneLockKey } from '@pospay/notifications';
import { sql } from 'drizzle-orm';

export async function lockPhone(tx: Tx, hash: Uint8Array): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${phoneLockKey(hash).toString()}::bigint)`);
}
