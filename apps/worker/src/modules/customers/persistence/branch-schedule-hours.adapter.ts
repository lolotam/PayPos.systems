import { branchScheduleHours } from '../../tenancy/index.ts';
import type { BranchScheduleHoursPort } from '../ports/branch-schedule-hours.port.ts';

export const branchScheduleHoursAdapter: BranchScheduleHoursPort = {
  hours: (tx, companyId, branchId) => branchScheduleHours(tx, companyId, branchId),
};
