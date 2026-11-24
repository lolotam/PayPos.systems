'use client';
import type { EmployeeSectionScope } from '../model/employee-detail-tabs';
import { EmployeeDocumentsSection } from './employee-documents-section';

/** تبويب «الوثائق»: قسم وثائق الموظف وحده. */
export function EmployeeDetailDocumentsTab({ scope }: { scope: EmployeeSectionScope }) {
  return <EmployeeDocumentsSection {...scope} />;
}
