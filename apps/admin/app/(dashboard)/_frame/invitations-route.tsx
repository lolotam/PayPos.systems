'use client';

import { InvitationsPage } from '@/permissions/pages/invitations-page';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';
import { useSessionUser } from '@/session/api/use-session';
import { useWorkspace } from '@/workspace/model/workspace-provider';

export function InvitationsRoute() {
  const locale = useLocale();
  const userId = useSessionUser(useMounted());
  const workspace = useWorkspace();
  if (workspace.status !== 'ready' || userId === null) return null;
  const choices = {
    businesses: workspace.company.businesses.map((business) => ({
      id: business.id,
      name: (locale === 'ar' ? business.name_ar : null) ?? business.name_en,
    })),
    branches: workspace.company.businesses.flatMap((business) =>
      business.branches.map((branch) => ({
        id: branch.id,
        name: (locale === 'ar' ? branch.name_ar : null) ?? branch.name_en,
      })),
    ),
  };
  return (
    <InvitationsPage
      key={`${workspace.company.id}:${userId}`}
      companyId={workspace.company.id}
      userId={userId}
      choices={choices}
      staffAccess={workspace.staffAccess === true}
    />
  );
}
