import { sql } from 'drizzle-orm';
import type { Tx } from '@pospay/db';

import type { RatingSentRepository } from '../ports/rating-sent.repository.ts';

/**
 * جملة الانتقال: لا تلمس إلا طلباً في SENDING مربوطاً بحدث الجاهزية نفسه، فإعادة التسليم والأحداث الغريبة بلا أثر.
 *
 * @param companyId الشركة صاحبة الطلب
 * @param readyEventId معرّف حدث الجاهزية
 * @param sentAt لحظة قبول المزود
 * @returns جملة SQL تعيد معرّف الصف المنتقل فقط
 */
export function ratingSentStatement(companyId: string, readyEventId: string, sentAt: Date) {
  const at = sentAt.toISOString();
  return sql`UPDATE rating_requests SET
      status = 'SENT', sent_at = ${at}::timestamptz, updated_at = ${at}::timestamptz
    WHERE company_id = ${companyId}::uuid AND ready_event_id = ${readyEventId}::uuid
      AND status = 'SENDING'
    RETURNING id`;
}

export const ratingSentRepository: RatingSentRepository<Tx> = {
  markSent: async (tx, companyId, readyEventId, sentAt) => {
    const rows = await tx.execute(ratingSentStatement(companyId, readyEventId, sentAt));
    return rows.length > 0;
  },
};
