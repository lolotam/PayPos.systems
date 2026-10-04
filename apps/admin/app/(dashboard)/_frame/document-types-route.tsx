'use client';
import { DocumentTypesPage } from '@/staff/pages/document-types-page';
import { useSessionUser } from '@/session/api/use-session';
import { useMounted } from '@/shared/browser/use-mounted';
import { useWorkspace } from '@/workspace/model/workspace-provider';

export function DocumentTypesRoute() {
  const userId = useSessionUser(useMounted());
  const workspace = useWorkspace();
  if (workspace.status !== 'ready' || userId === null) return null;
  return (
    <DocumentTypesPage
      key={`${workspace.company.id}:${userId}`}
      companyId={workspace.company.id}
      userId={userId}
    />
  );
}
