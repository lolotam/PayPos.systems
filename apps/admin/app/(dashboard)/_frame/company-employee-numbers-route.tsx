'use client';
import { CompanyEmployeeNumbersPage } from '@/staff/company-numbers/pages/company-employee-numbers-page';
import { useSessionUser } from '@/session/api/use-session';
import { useMounted } from '@/shared/browser/use-mounted';
import { useWorkspace } from '@/workspace/model/workspace-provider';

export function CompanyEmployeeNumbersRoute() {
  const userId = useSessionUser(useMounted());
  const workspace = useWorkspace();
  if (workspace.status !== 'ready' || userId === null) return null;
  return (
    <CompanyEmployeeNumbersPage
      key={`${workspace.company.id}:${userId}`}
      companyId={workspace.company.id}
      userId={userId}
    />
  );
}
