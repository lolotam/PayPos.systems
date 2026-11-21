'use client';

import type { CommissionPlanEmployeeListItem } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { EmptyState, Inbox } from '@pospay/ui';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { isPlanNotFound, type PlanScope } from '../api/plan-access';
import { useCommissionOverrideServices } from '../api/use-commission-override-services';
import type { OverrideAttemptMemory } from '../api/use-save-commission-override';
import { planRefusalMessage } from './plan-server-messages';
import { OverrideEditDialog } from './override-edit-dialog';
import { OverrideServicesTable } from './override-services-table';

/**
 * بلوك موظفة واحدة: جدول خدمات النشاط بالتجاوز الحالي لكل خدمة، والحوار بيتفتح على خدمة
 * واحدة بس. 404 على الموظفة محلي، و403 بيقفل النطاق كله من فوق.
 */
export function CommissionOverridesSection({
  scope,
  employee,
  employeeLabel,
  timeZone,
  memory,
}: {
  scope: PlanScope;
  employee: CommissionPlanEmployeeListItem;
  employeeLabel: string;
  timeZone: string;
  memory: OverrideAttemptMemory;
}) {
  const locale = useLocale();
  const services = useCommissionOverrideServices(scope, employee.id);
  const [openId, setOpenId] = useState<string | null>(null);
  const failure = services.isError ? services.error : null;
  const notFound = failure !== null && isPlanNotFound(failure);
  const items = services.data?.pages.flatMap((page) => page.items) ?? [];
  if (notFound) return <p role="alert">{planRefusalMessage(failure, locale)}</p>;
  const open = items.find((item) => item.service_id === openId) ?? null;
  const empty = services.data !== undefined && items.length === 0 && !services.hasNextPage;
  return (
    <div className="flex flex-col gap-4">
      <p className="font-semibold">{employeeLabel}</p>
      {failure !== null ? <p role="alert">{planRefusalMessage(failure, locale)}</p> : null}
      {empty ? (
        <EmptyState
          icon={<Inbox />}
          title={t(locale, 'commissionOverrides.emptyTitle')}
          description={t(locale, 'commissionOverrides.emptyBody')}
        />
      ) : null}
      {services.data !== undefined && !empty ? (
        <OverrideServicesTable
          items={items}
          hasNextPage={services.hasNextPage}
          loadingMore={services.isFetchingNextPage}
          loadMoreError={services.isFetchNextPageError}
          onLoadMore={() => services.fetchNextPage().catch(() => undefined)}
          onEdit={(item) => setOpenId(item.service_id)}
        />
      ) : null}
      {open !== null ? (
        <OverrideEditDialog
          key={open.service_id}
          scope={scope}
          employeeId={employee.id}
          timeZone={timeZone}
          service={open}
          memory={memory}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </div>
  );
}
