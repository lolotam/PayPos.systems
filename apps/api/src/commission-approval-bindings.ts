import { pendingCommissionEvents } from './modules/commissions/index.ts';
import {
  readCommissionApproveAccess,
  readCommissionStatementPayAccess,
  readExplicitCompanyFeature,
} from './modules/identity/index.ts';
import { readEmployeeEmploymentDates } from './modules/staff/index.ts';

/**
 * ما بيربطه الجذر لاعتماد كشف العمولة (53-2): صلاحية الاعتماد ومفتاحه الصريح من identity، وتواريخ العمل من staff،
 * والعدّاد من commissions نفسها. وصلاحية الصرف (54-1) من identity. في ملف مستقل لإبقاء app.ts تحت حد الأسطر.
 */
export const commissionApprovalBindings = {
  approveAccess: readCommissionApproveAccess,
  explicitFeature: readExplicitCompanyFeature,
  employment: { employmentDates: readEmployeeEmploymentDates },
  pending: pendingCommissionEvents,
  payAccess: readCommissionStatementPayAccess,
} as const;
