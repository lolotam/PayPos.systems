'use client';
import type { EmployeeSectionScope } from '../model/employee-detail-tabs';
import { EmployeeCardSection } from './employee-card-section';
import { EmployeeDefaultHoursSection } from './employee-default-hours-section';

/** تبويب «الدوام والبطاقة»: ساعات الدوام الافتراضية وبطاقة الحضور. */
export function EmployeeDetailHoursTab({ scope }: { scope: EmployeeSectionScope }) {
  return (
    <>
      <EmployeeDefaultHoursSection {...scope} />
      <EmployeeCardSection {...scope} />
    </>
  );
}
