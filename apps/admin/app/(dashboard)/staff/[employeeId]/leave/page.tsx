import { EmployeeDetailRoute } from '../../../_frame/employee-detail-route';
export default async function EmployeeLeavePage({
  params,
}: {
  params: Promise<{ employeeId: string }>;
}) {
  const { employeeId } = await params;
  return <EmployeeDetailRoute employeeId={employeeId} tab="leave" />;
}
