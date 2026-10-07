'use client';
import { EmployeeCardSection } from './employee-card-section';
import { EmployeeDocumentsSection } from './employee-documents-section';
import { EmployeeSalarySection } from './employee-salary-section';

export function EmployeeRecordSections(props: {
  companyId: string;
  businessId: string;
  userId: string;
  employeeId: string;
}) {
  return (
    <>
      <EmployeeSalarySection {...props} />
      <EmployeeCardSection {...props} />
      <EmployeeDocumentsSection {...props} />
    </>
  );
}
