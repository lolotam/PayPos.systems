import type { TenantWrappers } from '@pospay/db';

import { describeWorkspaces } from '../../tenancy/index.ts';
import type { AttendanceBranchReader } from '../ports/attendance-qr.port.ts';

export function createAttendanceBranchReader(database: TenantWrappers): AttendanceBranchReader {
  return {
    read: (companyId, branchId) =>
      database.withTenant(companyId, async (tx) => {
        const tree = await describeWorkspaces(tx, [{ scope: 'BRANCH', scopeId: branchId }]);
        const branch = tree?.businesses
          .flatMap((business) => business.branches)
          .find((candidate) => candidate.id === branchId && candidate.is_active);
        if (branch === undefined) return null;
        return {
          id: branch.id,
          name_ar: branch.name_ar,
          name_en: branch.name_en,
          effective_timezone: branch.effective_timezone,
        };
      }),
  };
}
