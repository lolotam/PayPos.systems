import { employeeAppLink, type EmployeeAppLink } from '@pospay/contracts';
import type { Tx } from '@pospay/db';

export const EMPLOYEE_APP_LINK_NAMES = Symbol('EMPLOYEE_APP_LINK_NAMES');

export interface EmployeeAppLinkBusiness {
  readonly id: string;
  readonly name_en: string;
  readonly name_ar: string | null;
}

/** واجهة القراءة بجوار الاستعلام عشان مسار القراءة ما يعتمدش على ports/. */
export interface EmployeeAppLinkNames {
  /**
   * بيرجّع اسم النشاط ومعرّفه للينك، أو null لو النشاط مش تابع للشركة دي.
   *
   * @param companyId الشركة المفتوحة في معاملة القراءة
   * @param businessId النشاط اللي الشاشة بتبني لينكه
   * @returns اسم النشاط ومعرّفه، أو null لو مش تابع للشركة
   */
  business(companyId: string, businessId: string): Promise<EmployeeAppLinkBusiness | null>;
}

export type EmployeeAppLinkNamesFactory = (tx: Tx) => EmployeeAppLinkNames;

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
