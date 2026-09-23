import { sql } from 'drizzle-orm';

import { assertUuid, type Tx } from './with-tenant.ts';

/**
 * event رايح لـ modules تانية — بيتكتب في الـ outbox جوه نفس transaction التغيير (CLAUDE.md §4.1، §6).
 */
export interface OutboxEvent {
  /** نوع الـ aggregate اللي اتغير، snake_case (company, business, order). */
  readonly aggregateType: string;
  readonly aggregateId: string;
  /** اسم الـ event، PascalCase (CompanyCreated) — نفس الاسم في events/published.ts. */
  readonly eventType: string;
  /** لازم يبقى JSON خالص: bigint أو Date لازم يتحولوا لنص قبل كده. */
  readonly payload: unknown;
}

// JSON.stringify بيرمي على bigint وبيرجّع undefined لـ undefined أو function — الاتنين غلط في payload.
export function toJsonb(value: unknown, name: string): string {
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError(`${name} must be JSON-serialisable`);
  return json;
}

/**
 * بيضيف event للـ outbox جوه الـ transaction اللي اتبعتت — لو الـ transaction عملت rollback الـ event بيروح معاها،
 * فمفيش event لتغيير متسجلش ولا تغيير من غير event. بيقفل الـ aggregate لحد آخر الـ transaction، فترتيب الـ events
 * بتاعته هو ترتيب الـ commit. الـ company_id بييجي من app_company_id() مش من الـ caller،
 * فمينفعش event يتكتب لشركة تانية، ومن غير withTenant بيفشل على NOT NULL.
 *
 * @param tx    transaction من withTenant أو withNewTenant
 * @param id    UUID v7 من الـ IdGenerator
 * @param event الـ event نفسه
 * @returns بيخلص لما الصف يتكتب (لسه مش committed)
 */
export async function appendOutboxEvent(tx: Tx, id: string, event: OutboxEvent): Promise<void> {
  const aggregateId = assertUuid(event.aggregateId, 'aggregateId');
  // Lock the aggregate for the rest of this transaction before its seq is taken: a second transaction emitting
  // for the same aggregate waits here until this one ends, so seq order is commit order and the dispatcher can
  // never see a later event while an earlier one is still uncommitted. Enforced here, not left to callers.
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(hashtextextended(
      app_company_id()::text || ':' || ${event.aggregateType} || ':' || ${aggregateId}, 0))`);
  await tx.execute(sql`
    INSERT INTO outbox (company_id, id, aggregate_type, aggregate_id, event_type, payload)
    VALUES (app_company_id(), ${assertUuid(id, 'id')}, ${event.aggregateType},
            ${aggregateId}, ${event.eventType},
            ${toJsonb(event.payload, 'payload')}::jsonb)`);
}
