'use client';
import { t } from '@pospay/i18n';
import { useState } from 'react';
import { AttendanceBoardPage } from '@/staff/pages/attendance-board-page';
import { useSessionUser } from '@/session/api/use-session';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';
import { useWorkspace } from '@/workspace/model/workspace-provider';
export function AttendanceBoardRoute() {
  const locale = useLocale();
  const userId = useSessionUser(useMounted());
  const workspace = useWorkspace();
  const [selection, setSelection] = useState<{ key: string; date: string | undefined }>();
  if (workspace.status !== 'ready' || userId === null) return null;
  if (!workspace.business) return <p>{t(locale, 'admin.chooseBusiness')}</p>;
  const branch = workspace.branch ?? workspace.business.branches[0];
  if (!branch) return <p>{t(locale, 'attendanceBoard.noBranches')}</p>;
  const scope = {
    companyId: workspace.company.id,
    businessId: workspace.business.id,
    branchId: branch.id,
    userId,
  };
  const key = `${scope.companyId}:${scope.businessId}:${branch.id}:${userId}`;
  return (
    <AttendanceBoardPage
      key={key}
      scope={scope}
      branches={workspace.business.branches}
      date={selection?.key === key ? selection.date : undefined}
      onDate={(date) => setSelection({ key, date })}
      onBranch={(branchId) =>
        workspace.choose({ companyId: scope.companyId, businessId: scope.businessId, branchId })
      }
    />
  );
}
