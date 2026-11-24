'use client';
import type { EmployeeSectionScope } from '../model/employee-detail-tabs';
import { EmployeeIbanSection } from './employee-iban-section';
import { EmployeeSalarySection } from './employee-salary-section';

/** تبويب «الراتب»: الراتب والحساب البنكي؛ منطقة الفرع الأساسي للحساب البنكي و`UTC` عند غيابها كما كانت. */
export function EmployeeDetailPayTab({
  scope,
  timeZone,
}: {
  scope: EmployeeSectionScope;
  timeZone: string | undefined;
}) {
  return (
    <>
      <EmployeeSalarySection {...scope} />
      <EmployeeIbanSection {...scope} timeZone={timeZone ?? 'UTC'} />
    </>
  );
}
