import { sql } from 'drizzle-orm';

import { assertUuid, type Tx } from './with-tenant.ts';

/**
 * بيسجّل إن الـ consumer ده طبّق الـ event ده — جوه نفس transaction التأثير، فالاتنين يتسجلوا مع بعض أو ولا واحد.
 * لو رجّع false يبقى الـ event ده اتطبق قبل كده (توصيل مكرر)، والـ consumer لازم ميعملش حاجة.
 *
 * @param tx         transaction من withTenant(event.companyId)
 * @param consumerId اسم الـ consumer الثابت (inventory.on-order-completed)
 * @param eventId    outbox.id بتاع الـ event
 * @returns true لو دي أول مرة، false لو اتطبق قبل كده
 */
export async function markEventConsumed(
  tx: Tx,
  consumerId: string,
  eventId: string,
): Promise<boolean> {
  const rows = await tx.execute(sql`
    INSERT INTO consumed_events (company_id, consumer_id, event_id)
    VALUES (app_company_id(), ${consumerId}, ${assertUuid(eventId, 'eventId')})
    ON CONFLICT DO NOTHING
    RETURNING 1 AS first`);
  return rows.length === 1;
}
