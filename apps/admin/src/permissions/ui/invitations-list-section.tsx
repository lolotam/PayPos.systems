'use client';

import type { MemberInvitation } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import type { UseInfiniteQueryResult } from '@tanstack/react-query';

import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import type { InvitationScopeChoices } from '../model/invitable-roles';
import { InvitationsTable } from './invitations-table';

type Props = {
  list: Pick<
    UseInfiniteQueryResult<{ pages: { items: MemberInvitation[] }[] }, unknown>,
    | 'data'
    | 'isPending'
    | 'isError'
    | 'error'
    | 'hasNextPage'
    | 'fetchNextPage'
    | 'isFetchingNextPage'
  >;
  /** أسماء الأنشطة والفروع: بتفرّق صف الدعوة عن صف شبهه (AC-ACT-22). */
  choices?: InvitationScopeChoices | undefined;
  reissuePending: boolean;
  onReissue: (invitation: MemberInvitation) => void;
};

/** قسم قائمة الدعوات: حالة التحميل والخطأ، والجدول بصفحاته من غير تكرار. */
export function InvitationsListSection({ list, choices, reissuePending, onReissue }: Props) {
  const locale = useLocale();
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t(locale, 'invitations.listTitle')}</h2>
      {list.isPending ? <p role="status">{t(locale, 'admin.loading')}</p> : null}
      {list.isError ? <p role="alert">{envelopeMessage(list.error, locale)}</p> : null}
      {list.data ? (
        <InvitationsTable
          items={items}
          choices={choices}
          hasMore={list.hasNextPage}
          onLoadMore={() => void list.fetchNextPage()}
          loadingMore={list.isFetchingNextPage}
          reissuePending={reissuePending}
          onReissue={onReissue}
        />
      ) : null}
    </div>
  );
}
