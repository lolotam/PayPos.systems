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
          const hash = installationHash(input.companyId, input.installationId);
          // سقف رخيص: محاولة واحدة لكل موظف وخطوة وتثبيت في الدقيقة، فالضغط المتكرر لا يملأ الجدول.
          const [written] = await tx.execute<{ employees: number }>(sql`
          WITH employee AS (
            SELECT e.id,e.primary_branch_id FROM employees e
            WHERE e.company_id=${input.companyId} AND e.business_id=${input.businessId} AND e.id=${input.employeeId}
          ), inserted AS (
            INSERT INTO attendance_device_refusals(company_id,id,business_id,branch_id,employee_id,holder_employee_id,step,reason,installation_hash,attempted_at)
            SELECT ${input.companyId},${ids.newId()},${input.businessId},COALESCE(${input.branchId}::uuid,employee.primary_branch_id),employee.id,
              ${input.holderEmployeeId},${input.step},${input.reason},${hash},${input.at.toISOString()}
            FROM employee WHERE NOT EXISTS (
              SELECT 1 FROM attendance_device_refusals r
              WHERE r.company_id=${input.companyId} AND r.business_id=${input.businessId} AND r.employee_id=${input.employeeId}
                AND r.step=${input.step} AND r.installation_hash=${hash}
                AND r.attempted_at>${input.at.toISOString()}::timestamptz-interval '60 seconds')
            RETURNING id
          )
          SELECT (SELECT count(*) FROM employee)::int AS employees`);
          if (written?.employees !== 1) throw new Error('ATTENDANCE_REFUSAL_EMPLOYEE_MISSING');
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
