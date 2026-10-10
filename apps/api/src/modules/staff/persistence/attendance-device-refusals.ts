import type { IdGenerator, TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { AttendanceDeviceRefusals } from '../ports/attendance-device-refusals.port.ts';
import { installationHash } from './attendance-device-signal.ts';

export function createAttendanceDeviceRefusals(
  database: TenantWrappers,
  ids: IdGenerator,
  report: (companyId: string, employeeId: string) => void,
): AttendanceDeviceRefusals {
  return {
    record: async (input) => {
      try {
        await database.withTenant(input.companyId, async (tx) => {
          const inserted = await tx.execute(sql`
          INSERT INTO attendance_device_refusals(company_id,id,business_id,branch_id,employee_id,holder_employee_id,step,reason,installation_hash,attempted_at)
          SELECT ${input.companyId},${ids.newId()},${input.businessId},COALESCE(${input.branchId}::uuid,e.primary_branch_id),e.id,
            ${input.holderEmployeeId},${input.step},${input.reason},${installationHash(input.companyId, input.installationId)},${input.at.toISOString()}
          FROM employees e WHERE e.company_id=${input.companyId} AND e.business_id=${input.businessId} AND e.id=${input.employeeId}
          RETURNING id`);
          if (inserted.length !== 1) throw new Error('ATTENDANCE_REFUSAL_EMPLOYEE_MISSING');
        });
      } catch {
        try {
          report(input.companyId, input.employeeId);
        } catch {
          /* فشل التشخيص لا يغير الرفض الأصلي. */
        }
      }
    },
  };
}
