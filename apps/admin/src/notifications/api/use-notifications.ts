'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  inAppNotificationPage,
  notificationReadResult,
  notificationUnreadCount,
} from '@pospay/contracts';
import { apiClient } from '@/shared/api/client';

const key = (companyId: string | undefined) => ['me', 'notifications', companyId] as const;
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

export function useNotifications(companyId: string | undefined, open: boolean) {
  const client = useQueryClient();
  const count = useQuery({
    queryKey: [...key(companyId), 'count'],
    queryFn: () => fetchCount(companyId),
    enabled: companyId !== undefined,
    refetchInterval: 60_000,
  });
  const list = useQuery({
    queryKey: [...key(companyId), 'list'],
    queryFn: ({ signal }) => fetchNotifications(companyId, signal),
    enabled: companyId !== undefined && open,
    refetchInterval: 60_000,
  });
  const read = useMutation({
    mutationFn: (id: string | undefined) => markRead(companyId, id),
    onSuccess: () => client.invalidateQueries({ queryKey: key(companyId) }),
  });
  return { count, list, read };
}
