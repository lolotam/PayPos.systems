import { readStaffColumns } from '../../settings/index.ts';
import type { StaffColumnsPort } from '../ports/staff-columns.port.ts';

export const staffColumns: StaffColumnsPort = {
  allowed: async (tx, companyId, businessId) =>
    new Set((await readStaffColumns(tx, companyId, businessId)).columns),
  monthsBack: async (tx, companyId, businessId) =>
    (await readStaffColumns(tx, companyId, businessId)).monthsBack,
};
