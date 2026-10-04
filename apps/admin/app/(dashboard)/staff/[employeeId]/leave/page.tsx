import { EmployeeLeaveRoute } from '../../../_frame/employee-leave-route';
export default async function EmployeeLeavePage({
  params,
}: {
  params: Promise<{ employeeId: string }>;
}) {
  const { employeeId } = await params;
  return <EmployeeLeaveRoute employeeId={employeeId} />;
}
