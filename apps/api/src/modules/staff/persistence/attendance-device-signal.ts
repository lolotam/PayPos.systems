import { createHash } from 'node:crypto';
import { attendanceInstallationSignal } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/** PR22 يستدعي الكاتب داخل معاملة أثر الحضور المقبول فقط؛ المعرف الخام لا يخرج من الذاكرة. */
export async function recordAttendanceDeviceSignal(
  tx: Tx,
  record: {
    companyId: string;
    id: string;
    businessId: string;
    branchId: string;
    employeeId: string;
    clockEventId: string;
    clockedAt: Date;
    installationId: string;
  },
): Promise<void> {
  const signal = attendanceInstallationSignal.parse({ installation_id: record.installationId });
  const hash = installationHash(record.companyId, signal.installation_id);
  await tx.execute(sql`INSERT INTO attendance_device_signals(company_id,id,business_id,branch_id,employee_id,clock_event_id,installation_hash,clocked_at)
    VALUES(${record.companyId},${record.id},${record.businessId},${record.branchId},${record.employeeId},${record.clockEventId},${hash},${record.clockedAt.toISOString()})
    ON CONFLICT(company_id,clock_event_id) DO NOTHING`);
}

export function installationHash(companyId: string, installationId: string): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        'pospay.attendance.installation.v1',
        companyId.toLowerCase(),
        installationId.toLowerCase(),
      ]),
    )
    .digest('hex');
}
