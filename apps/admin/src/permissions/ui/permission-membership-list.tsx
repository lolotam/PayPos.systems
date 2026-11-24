'use client';

import { t } from '@pospay/i18n';
import { DataTableFrame, EmptyState, UserRound } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import type { usePermissionMemberships } from '../api/use-permissions';
import { PermissionListFeedback } from './permission-list-feedback';
import { PermissionMembershipTable } from './permission-membership-table';
import { PermissionPageNavigation } from './permission-page-navigation';

export function PermissionMembershipList({
  list,
  cursor,
  membershipId,
  scopeNames,
  onSelect,
  onCursor,
}: {
  list: ReturnType<typeof usePermissionMemberships>;
  cursor: string | undefined;
  membershipId: string;
  scopeNames: Readonly<Record<string, string>>;
  onSelect: (id: string) => void;
  onCursor: (next: string | undefined) => void;
}) {
  const locale = useLocale();
  const loaded = !list.isPending && !list.isFetching && !list.isError && !list.failureCount;
  return (
    <>
      <PermissionListFeedback
        pending={list.isPending || list.isFetching}
        failed={list.isError || list.failureCount > 0}
        error={list.error ?? list.failureReason}
      />
      {loaded && list.data ? (
        <DataTableFrame
          title={t(locale, 'permissions.person')}
          stacked
          footer={
            <PermissionPageNavigation
              cursor={cursor}
              next={list.data.next_cursor}
              onChange={onCursor}
            />
          }
        >
          {list.data.items.length === 0 ? (
            <EmptyState icon={<UserRound />} title={t(locale, 'permissions.empty')} />
          ) : (
            <PermissionMembershipTable
              items={list.data.items}
              selectedId={membershipId}
              scopeNames={scopeNames}
              onSelect={onSelect}
            />
          )}
        </DataTableFrame>
      ) : null}
    </>
  );
}
