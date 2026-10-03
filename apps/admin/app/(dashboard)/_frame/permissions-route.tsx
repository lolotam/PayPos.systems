'use client';

import { PermissionsPage } from '@/permissions/pages/permissions-page';
import { useSessionUser } from '@/session/api/use-session';
import { useMounted } from '@/shared/browser/use-mounted';
import { useWorkspace } from '@/workspace/model/workspace-provider';
import { workspaceScopeNames } from '@/workspace/model/scope-names';
import { useLocale } from '@/shared/locale/locale-context';

export function PermissionsRoute() {
  const locale = useLocale();
  const userId = useSessionUser(useMounted());
  const workspace = useWorkspace();
  if (workspace.status !== 'ready' || userId === null) return null;
  return (
    <PermissionsPage
      key={`${workspace.company.id}:${userId}`}
      companyId={workspace.company.id}
      userId={userId}
      business={
        workspace.business
          ? {
              id: workspace.business.id,
              name:
                (locale === 'ar' ? workspace.business.name_ar : null) ?? workspace.business.name_en,
            }
          : undefined
      }
      scopeNames={workspaceScopeNames(workspace.company, locale)}
      branchTimeZones={Object.fromEntries(
        workspace.company.businesses.flatMap((business) =>
          business.branches.map((branch) => [branch.id, branch.effective_timezone]),
        ),
      )}
    />
  );
}
