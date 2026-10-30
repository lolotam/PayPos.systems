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

// إنشاء إصدار خطة العمولة يقرأ توقيت النشاط وتاريخ إنشائه معاً قبل قفل شهوره.
export async function businessCalendar(
  tx: Tx,
  companyId: string,
  businessId: string,
): Promise<{ readonly timeZone: string; readonly createdAt: Date } | null> {
  const [row] = await tx.execute<{ timezone: string; created_at: string }>(
    sql`SELECT timezone,created_at FROM businesses WHERE company_id=${companyId} AND id=${businessId}`,
  );
  if (row === undefined) return null;
  return { timeZone: row.timezone, createdAt: new Date(row.created_at) };
}
