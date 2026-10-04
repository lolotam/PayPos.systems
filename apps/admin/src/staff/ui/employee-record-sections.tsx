'use client';
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
      <EmployeeDocumentsSection {...props} />
    </>
  );
}
