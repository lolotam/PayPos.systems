import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import type { LeavePage, LeaveRequest } from '@pospay/contracts';

export function refreshCancelledLeave(cache: QueryClient, key: string[], confirmed: LeaveRequest) {
  cache.setQueryData<InfiniteData<LeavePage>>(
    key,
    (previous) =>
      previous && {
        ...previous,
        pages: previous.pages.map((page) => ({
          ...page,
          items: page.items.map((item) =>
            item.id === confirmed.id
              ? { ...item, ...confirmed, can_cancel: false, can_decide: false, can_revoke: false }
              : item,
          ),
        })),
      },
  );
  return cache.invalidateQueries({ queryKey: key });
}
