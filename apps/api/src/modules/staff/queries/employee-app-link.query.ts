import { employeeAppLink, type EmployeeAppLink } from '@pospay/contracts';
import type { EmployeeAppLinkNames } from '../ports/employee-app-link-names.port.ts';

// Screen: admin › staff › تطبيق الموظفات (spec 069 FR-005).
export async function readEmployeeAppLink(
  names: EmployeeAppLinkNames,
  companyId: string,
  businessId: string,
): Promise<EmployeeAppLink | null> {
  const business = await names.business(companyId, businessId);
  if (business === null) return null;
  return employeeAppLink.parse({
    company_id: companyId,
    business_id: business.id,
    business_name_en: business.name_en,
    business_name_ar: business.name_ar,
  });
}
