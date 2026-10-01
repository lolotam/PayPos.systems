'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  inAppNotificationPage,
  notificationReadResult,
  notificationUnreadCount,
} from '@pospay/contracts';
import { apiClient } from '@/shared/api/client';

const key = (companyId: string | undefined, userId: string | null) =>
  ['me', 'notifications', companyId, userId] as const;
const params = (companyId: string | undefined) => ({ header: { 'x-company-id': companyId ?? '' } });

async function fetchCount(companyId: string | undefined) {
  const { data, error } = await apiClient().GET('/v1/me/notifications/unread-count', {
    params: params(companyId),
  });
  if (error) throw error;
  return notificationUnreadCount.parse(data);
}

async function fetchNotifications(companyId: string | undefined, signal: AbortSignal) {
  const { data, error } = await apiClient().GET('/v1/me/notifications', {
    params: { ...params(companyId), query: { limit: 20 } },
    signal,
  });
  if (error) throw error;
  return inAppNotificationPage.parse(data);
}

async function markRead(companyId: string | undefined, id: string | undefined) {
  const response =
    id === undefined
      ? await apiClient().POST('/v1/me/notifications/read-all', { params: params(companyId) })
      : await apiClient().POST('/v1/me/notifications/{id}/read', {
          params: { ...params(companyId), path: { id } },
        });
  if (response.error) throw response.error;
  return notificationReadResult.parse(response.data);
}

export function useNotifications(
  companyId: string | undefined,
  open: boolean,
  userId: string | null,
) {
  const client = useQueryClient();
  const enabled = companyId !== undefined && userId !== null;
  const count = useQuery({
    queryKey: [...key(companyId, userId), 'count'],
    queryFn: () => fetchCount(companyId),
    enabled,
    refetchInterval: 60_000,
  });
  const list = useQuery({
    queryKey: [...key(companyId, userId), 'list'],
    queryFn: ({ signal }) => fetchNotifications(companyId, signal),
    enabled: enabled && open,
    refetchInterval: 60_000,
  });
  const read = useMutation({
    mutationKey: [...key(companyId, userId), 'read'],
    mutationFn: (id: string | undefined) => {
      if (!enabled) throw new Error('NOTIFICATION_SESSION_REQUIRED');
      return markRead(companyId, id);
    },
    // الرد قد يصل بعد تبديل الحساب؛ إبطال الكاش يظل لهوية بدء الكتابة.
    onMutate: () => ({ queryKey: key(companyId, userId) }),
    onSuccess: (_data, _id, context) => client.invalidateQueries({ queryKey: context.queryKey }),
  });
  return { count, list, read };
}
