import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { SuppressionGate } from '../ports/suppression-gate.port.ts';

export function createSuppressionGate(tx: Tx): SuppressionGate {
  return {
    isSuppressed: async (hash) => {
      const [row] = await tx.execute<{ suppressed: boolean; isolation: string }>(sql`
        SELECT pg_catalog.current_setting('transaction_isolation') AS isolation,
          public.platform_whatsapp_is_suppressed(${Buffer.from(hash)}) AS suppressed`);
      if (row?.isolation !== 'read committed' || typeof row.suppressed !== 'boolean')
        throw new Error('SUPPRESSION_CHECK_FAILED');
      return row.suppressed;
    },
  };
}
