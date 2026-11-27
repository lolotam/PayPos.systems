'use client';

import { t } from '@pospay/i18n';
import { notFound } from 'next/navigation';

import { DevicesPage } from '@/devices/pages/devices-page';
import { useSessionUser } from '@/session/api/use-session';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';
import { useWorkspace } from '@/workspace/model/workspace-provider';

import { useVisiblePageIds } from './menu/use-visible-page-ids';

// شاشة أجهزة الفرع (spec 071): المدخل في القائمة يبان للأدوار الأربعة بس، والفرع بيتاخد من الشريط
// العلوي زي باقي شاشات الفرع.
export function DevicesRoute() {
  const locale = useLocale();
  const visibleIds = useVisiblePageIds();
  const userId = useSessionUser(useMounted());
  const workspace = useWorkspace();
  if (!visibleIds.includes('pos-devices-and-pins')) notFound();
  if (workspace.status !== 'ready' || userId === null) return null;
  if (!workspace.business) return <p>{t(locale, 'admin.chooseBusiness')}</p>;
  const branch = workspace.branch ?? workspace.business.branches[0];
  if (!branch) return <p>{t(locale, 'devices.noBranches')}</p>;
  const scope = {
    companyId: workspace.company.id,
    businessId: workspace.business.id,
    branchId: branch.id,
    userId,
  };
  const key = `${scope.companyId}:${scope.businessId}:${branch.id}:${userId}`;
  return (
    <DevicesPage
      key={key}
      scope={scope}
      branches={workspace.business.branches}
      onBranch={(branchId) =>
        workspace.choose({ companyId: scope.companyId, businessId: scope.businessId, branchId })
      }
    />
  );
}
