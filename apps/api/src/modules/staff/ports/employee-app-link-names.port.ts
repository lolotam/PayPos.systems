export interface EmployeeAppLinkBusiness {
  readonly id: string;
  readonly name_en: string;
  readonly name_ar: string | null;
}

/** بيوفّر بيانات النشاط اللي شاشة لينك تطبيق الموظفات بتعرضها وتبني منها اللينك. */
export interface EmployeeAppLinkNames {
  /** بيرجّع اسم النشاط ومعرّفه للينك، أو null لو النشاط مش تابع للشركة دي. */
  business(companyId: string, businessId: string): Promise<EmployeeAppLinkBusiness | null>;
}
