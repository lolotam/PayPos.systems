'use client';

import { PermissionsPage } from '@/permissions/pages/permissions-page';
import { useSessionUser } from '@/session/api/use-session';
import { useMounted } from '@/shared/browser/use-mounted';
import { useWorkspace } from '@/workspace/model/workspace-provider';

export function PermissionsRoute() {
  const userId = useSessionUser(useMounted());
  const workspace = useWorkspace();
  if (workspace.status !== 'ready' || userId === null) return null;
  return (
    <PermissionsPage
      key={`${workspace.company.id}:${userId}`}
      companyId={workspace.company.id}
      userId={userId}
      branchTimeZones={Object.fromEntries(
        workspace.company.businesses.flatMap((business) =>
          business.branches.map((branch) => [branch.id, branch.effective_timezone]),
        ),
      )}
    />
  );
}
