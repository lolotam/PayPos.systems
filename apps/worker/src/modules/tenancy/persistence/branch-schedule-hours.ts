import { openingHours, type OpeningHours } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

export async function branchScheduleHours(
  tx: Tx,
  companyId: string,
  branchId: string,
): Promise<{ openingHours: OpeningHours | null; timeZone: string } | null> {
  const rows = await tx.execute<{ opening_hours: unknown; time_zone: string }>(sql`SELECT
      b.opening_hours, COALESCE(b.timezone, bu.timezone) AS time_zone
    FROM branches b
    JOIN businesses bu ON bu.company_id = b.company_id AND bu.id = b.business_id
    WHERE b.company_id = ${companyId} AND b.id = ${branchId}`);
  const row = rows[0];
  if (row === undefined) return null;
  if (row.opening_hours === null) return { openingHours: null, timeZone: row.time_zone };
  const parsed = openingHours.safeParse(row.opening_hours);
  if (!parsed.success) throw new Error('BRANCH_OPENING_HOURS_INVALID');
  return { openingHours: parsed.data, timeZone: row.time_zone };
}
