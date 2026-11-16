'use client';
import {
  closeServiceCategoryResult,
  reopenServiceCategoryResult,
  serviceCategoryClosingPending,
  serviceCategoryClosingStatus,
  type ServiceCategoryClosingAction,
  type ServiceCategoryClosingStatus,
} from '@pospay/contracts';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { apiClient } from '@/shared/api/client';
import type {
  ServiceCategoryClosingMutationResult,
  TrackedServiceCategoryClosing,
} from '../model/service-category-closing';
import { key as servicesKey } from './use-services';
import { serviceCategoryKey } from './use-service-category-list';

export type ServiceCategoryClosingRequest = {
  categoryId: string;
  action: ServiceCategoryClosingAction;
  expected_revision: number;
  expected_service_count: number;
};

export function stopsPolling(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('status' in error)) return false;
  return error.status === 403 || error.status === 404;
}

async function run(
  companyId: string,
  businessId: string,
  input: ServiceCategoryClosingRequest,
): Promise<ServiceCategoryClosingMutationResult> {
  const params = {
    header: { 'x-company-id': companyId },
    path: { businessId, categoryId: input.categoryId },
  };
  const body = {
    expected_revision: input.expected_revision,
    expected_service_count: input.expected_service_count,
  };
  const response =
    input.action === 'close'
      ? await apiClient().POST(
          '/v1/businesses/{businessId}/service-categories/{categoryId}/close',
          {
            params,
            body,
          },
        )
      : await apiClient().POST(
          '/v1/businesses/{businessId}/service-categories/{categoryId}/reopen',
          { params, body },
        );
  if (response.error) throw { ...response.error, status: response.response.status };
  if (response.response.status === 202) {
    const pending = serviceCategoryClosingPending.parse(response.data);
    return { kind: 'pending', action: input.action, closingId: pending.closing_id };
  }
  const count =
    input.action === 'close'
      ? closeServiceCategoryResult.parse(response.data).services_closed
      : reopenServiceCategoryResult.parse(response.data).services_reopened;
  return { kind: 'done', action: input.action, servicesChanged: count };
}

async function status(
  companyId: string,
  businessId: string,
  categoryId: string,
  closingId: string,
  signal: AbortSignal,
): Promise<ServiceCategoryClosingStatus> {
  const response = await apiClient().GET(
    '/v1/businesses/{businessId}/service-categories/{categoryId}/closings/{closingId}',
    {
      params: {
        header: { 'x-company-id': companyId },
        path: { businessId, categoryId, closingId },
      },
      signal,
    },
  );
  if (response.error) throw { ...response.error, status: response.response.status };
  return serviceCategoryClosingStatus.parse(response.data);
}

type ServiceCategoryClosingQueryOptions = {
  companyId: string;
  businessId: string;
  userId: string;
  categoryId: string;
  closingId: string;
  pollMs: number;
};

function closingStatusQuery({
  companyId,
  businessId,
  userId,
  categoryId,
  closingId,
  pollMs,
}: ServiceCategoryClosingQueryOptions) {
  return {
    queryKey: ['closing-status', companyId, businessId, userId, categoryId, closingId],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      status(companyId, businessId, categoryId, closingId, signal),
    enabled: categoryId !== '' && closingId !== '',
    retry: (count: number, error: unknown) => count < 3 && !stopsPolling(error),
    refetchInterval: (current: {
      state: { error: unknown; data: ServiceCategoryClosingStatus | undefined };
    }) => {
      if (stopsPolling(current.state.error)) return false;
      return !current.state.data || current.state.data.status === 'pending' ? pollMs : false;
    },
  };
}

/** جسم 202 مفيهوش kind على السلك، فالتمييز بين النتيجة الفورية والمهمة الخلفية بيتم من HTTP status. */
export function useServiceCategoryClosing(companyId: string, businessId: string, userId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: ['service-category-closing', companyId, businessId, userId],
    mutationFn: (input: ServiceCategoryClosingRequest) => run(companyId, businessId, input),
    onSuccess: (result) => {
      if (result.kind !== 'done') return;
      void client.invalidateQueries({
        queryKey: serviceCategoryKey(companyId, businessId, userId),
      });
      void client.invalidateQueries({ queryKey: servicesKey(companyId, businessId, userId) });
    },
  });
}

/** الـ403 والـ404 حالة نهائية مش انقطاع مؤقت، فالاستطلاع والـretry بيقفوا بدل طلبات لن تتغير إجابتها. */
export function useServiceCategoryClosingStatus(
  companyId: string,
  businessId: string,
  userId: string,
  categoryId: string,
  closingId: string,
  pollMs = 2_000,
  onTerminal?: (value: ServiceCategoryClosingStatus) => void,
) {
  const client = useQueryClient();
  const handled = useRef('');
  const query = useQuery(
    closingStatusQuery({ companyId, businessId, userId, categoryId, closingId, pollMs }),
  );
  const data = query.data;
  useEffect(() => {
    if (!data || data.status === 'pending') return;
    const receipt = `${data.closing_id}:${data.status}`;
    if (handled.current === receipt) return;
    handled.current = receipt;
    onTerminal?.(data);
    void client.invalidateQueries({ queryKey: serviceCategoryKey(companyId, businessId, userId) });
    void client.invalidateQueries({ queryKey: servicesKey(companyId, businessId, userId) });
  }, [businessId, client, companyId, data, onTerminal, userId]);
  return query;
}

type ServiceCategoryClosingStatusesOptions = {
  companyId: string;
  businessId: string;
  userId: string;
  jobs: readonly Pick<TrackedServiceCategoryClosing, 'categoryId' | 'closingId'>[];
  pollMs?: number;
  onTerminal?: (closingStatus: ServiceCategoryClosingStatus) => void;
};

/** كل مهمة خلفية لها استعلام مستقل حتى لا يوقف تصنيف جديد متابعة تصنيف سابق. */
export function useServiceCategoryClosingStatuses({
  companyId,
  businessId,
  userId,
  jobs,
  pollMs = 2_000,
  onTerminal,
}: ServiceCategoryClosingStatusesOptions) {
  const client = useQueryClient();
  const handled = useRef(new Set<string>());
  const queries = useQueries({
    queries: jobs.map(({ categoryId, closingId }) =>
      closingStatusQuery({ companyId, businessId, userId, categoryId, closingId, pollMs }),
    ),
  });
  const terminalStatuses = queries.flatMap(({ data: closingStatus }) =>
    closingStatus && closingStatus.status !== 'pending' ? [closingStatus] : [],
  );
  useEffect(() => {
    for (const terminalStatus of terminalStatuses) {
      const receipt = `${terminalStatus.closing_id}:${terminalStatus.status}`;
      if (handled.current.has(receipt)) continue;
      handled.current.add(receipt);
      onTerminal?.(terminalStatus);
      void client.invalidateQueries({ queryKey: serviceCategoryKey(companyId, businessId, userId) });
      void client.invalidateQueries({ queryKey: servicesKey(companyId, businessId, userId) });
    }
  }, [businessId, client, companyId, onTerminal, terminalStatuses, userId]);
  return queries;
}
