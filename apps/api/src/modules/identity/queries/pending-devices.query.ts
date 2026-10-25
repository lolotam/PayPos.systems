import { pendingDevicesResponse, type PendingDevicesResponse } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

type PendingDeviceRow = {
  readonly id: string;
  readonly label: string;
  readonly created_at: Date | string;
};

// الـ driver بيردّ بالـ Date أو بالـ string؛ الرد دايماً ISO واحد عشان كل عميل يفسّر نفس اللحظة بنفسه.
function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export async function listPendingDevices(
  tx: Tx,
  companyId: string,
  branchId: string,
): Promise<PendingDevicesResponse> {
  // شاشة موافقة الأجهزة في الأدمن وفحص iOS: أجهزة الفرع اللي مستنية الموافقة، الأحدث الأول.
  const rows = await tx.execute<PendingDeviceRow>(sql`
    SELECT id, label, created_at
    FROM devices
    WHERE company_id = ${companyId} AND branch_id = ${branchId} AND status = 'PENDING'
    ORDER BY created_at DESC, id DESC
    LIMIT 50`);
  return pendingDevicesResponse.parse({
    items: Array.from(rows).map((row) => ({
      id: row.id,
      label: row.label,
      created_at: iso(row.created_at),
    })),
  });
}
