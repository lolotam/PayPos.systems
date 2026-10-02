import type { TenantWrappers } from '@pospay/db';
import type { StaffDeviceContext } from '@pospay/auth';
import { sql } from 'drizzle-orm';
import { staffEligible } from '../domain/staff-eligibility.ts';
import { readAccessTransaction } from './access-reader.ts';

export function createStaffEligibility(database: TenantWrappers) {
  const context = (
    device: { companyId: string; deviceId: string; branchId: string },
    deadline?: Date,
  ) =>
    database.withTenant(
      device.companyId,
      async (tx) => {
        const [row] = await tx.execute<{ business_id: string }>(sql`
        SELECT b.business_id FROM devices d JOIN branches b ON b.company_id=d.company_id AND b.id=d.branch_id
        JOIN companies c ON c.id=d.company_id
        WHERE d.company_id=${device.companyId} AND d.id=${device.deviceId} AND d.branch_id=${device.branchId}
          AND d.status='ACTIVE' AND d.approved_by IS NOT NULL AND d.approved_at IS NOT NULL
          AND d.token_expires_at>clock_timestamp()`);
        return row === undefined ? null : { ...device, businessId: row.business_id };
      },
      deadline === undefined
        ? {}
        : { timeoutMs: Math.max(1, deadline.getTime() - Date.now()), drainOnTimeout: true },
    );
  return {
    context,
    deviceValid: async (device: StaffDeviceContext) =>
      (await context(device))?.businessId === device.businessId,
    eligible: async (userId: string, device: StaffDeviceContext, deadline?: Date) => {
      return database.withTenant(
        device.companyId,
        async (tx) => {
          const [company] = await tx.execute<{ active: boolean }>(
            sql`SELECT deleted_at IS NULL AS active FROM companies WHERE id=${device.companyId}`,
          );
          if (company?.active !== true) return false;
          const access = await readAccessTransaction(tx, device.companyId, userId);
          return staffEligible(access.memberships, access.grants, device);
        },
        {
          userId,
          ...(deadline === undefined
            ? {}
            : { timeoutMs: Math.max(1, deadline.getTime() - Date.now()), drainOnTimeout: true }),
        },
      );
    },
  };
}
