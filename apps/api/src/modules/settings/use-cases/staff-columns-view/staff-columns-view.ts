import type { StaffColumnsSettings } from '@pospay/contracts';

import { effectiveStaffColumns, effectiveStaffMonthsBack } from '../../domain/staff-columns.ts';
import type { StoredStaffColumns } from '../../ports/staff-columns-settings.port.ts';

/**
 * The response every caller of the setting sees: what the "my" reads apply, and whether it is the default.
 *
 * @param businessId the business
 * @param stored     what is stored
 * @returns the effective setting
 */
export function staffColumnsView(
  businessId: string,
  stored: StoredStaffColumns,
): StaffColumnsSettings {
  return {
    business_id: businessId,
    columns: effectiveStaffColumns(stored.columns),
    columns_default: stored.columns === null,
    months_back: effectiveStaffMonthsBack(stored.monthsBack),
    months_back_default: stored.monthsBack === null,
  };
}
