'use client';
import { EmployeeCardSection } from './employee-card-section';
import { EmployeeDocumentsSection } from './employee-documents-section';
import { EmployeeSalarySection } from './employee-salary-section';
import { EmployeeIbanSection } from './employee-iban-section';
import { EmployeeDefaultHoursSection } from './employee-default-hours-section';

export function EmployeeRecordSections({
  timeZone,
  ...props
}: {
  companyId: string;
  businessId: string;
  userId: string;
  employeeId: string;
  timeZone?: string | undefined;
}) {
  return (
    <>
      <EmployeeSalarySection {...props} />
      <EmployeeIbanSection {...props} timeZone={timeZone ?? 'UTC'} />
      <EmployeeDefaultHoursSection {...props} />
      <EmployeeCardSection {...props} />
      <EmployeeDocumentsSection {...props} />
    </>
  );
}
