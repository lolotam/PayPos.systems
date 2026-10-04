import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

// شارة انتهاء وثائق الموظفين تحسب اليوم بتوقيت النشاط نفسه، لا بتوقيت فرع بعينه.
export function businessTimeZoneStatement(companyId: string, businessId: string) {
  return sql`SELECT timezone FROM businesses WHERE company_id=${companyId} AND id=${businessId}`;
}

export async function businessTimeZone(
  tx: Tx,
  companyId: string,
  businessId: string,
): Promise<string | null> {
  const [row] = await tx.execute<{ timezone: string }>(
    businessTimeZoneStatement(companyId, businessId),
  );
  return row?.timezone ?? null;
}
