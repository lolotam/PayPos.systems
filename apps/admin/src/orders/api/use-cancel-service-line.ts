'use client';
import {
  cancelServiceLineResponse,
  type CancelServiceLineInput,
  type CancelServiceLineResponse,
  type ServiceSessionDayPage,
} from '@pospay/contracts';
import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useRef } from 'react';
import { apiClient } from '@/shared/api/client';
import { cancelOutcomeKnown } from '../model/cancel-service-line-values';
import { applyCancelledLine, type CancelledDaySource } from '../model/cancelled-day-line';
import type { SessionServiceScope } from './use-session-services';

const cancelPath =
  '/v1/businesses/{businessId}/branches/{branchId}/service-sessions/{sessionId}/lines/{lineId}/cancellation';
type CancelAttempt = { sessionId: string; lineId: string; body: CancelServiceLineInput };
type Held = { key: string; fingerprint: string };
type DayData = InfiniteData<ServiceSessionDayPage>;
export type CancelServiceLineResult = { response: CancelServiceLineResponse };

function requestBody(body: CancelServiceLineInput) {
  return {
    expected_revision: body.expected_revision,
    ...(body.reason === undefined ? {} : { reason: body.reason }),
    ...(body.canceller_membership_id === undefined
      ? {}
      : { canceller_membership_id: body.canceller_membership_id }),
  };
}

function patchCancelledLine(
  data: DayData | undefined,
  sessionId: string,
  lineId: string,
  next: CancelledDaySource,
): DayData | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((item) =>
        item.id === sessionId
          ? {
              ...item,
              lines: item.lines.map((line) =>
                line.id === lineId ? applyCancelledLine(line, next) : line,
              ),
            }
          : item,
      ),
    })),
  };
}

async function postCancellation(
  scope: SessionServiceScope,
  attempt: CancelAttempt,
  held: { current: Held | null },
): Promise<CancelServiceLineResult> {
  const fingerprint = JSON.stringify({
    sessionId: attempt.sessionId,
    lineId: attempt.lineId,
    body: attempt.body,
  });
  const key =
    held.current?.fingerprint === fingerprint
      ? held.current
      : { key: crypto.randomUUID(), fingerprint };
  held.current = key;
  const result = await apiClient().POST(cancelPath, {
    params: {
      header: { 'x-company-id': scope.companyId, 'Idempotency-Key': key.key },
      path: {
        businessId: scope.businessId,
        branchId: scope.branchId,
        sessionId: attempt.sessionId,
        lineId: attempt.lineId,
      },
    },
    body: requestBody(attempt.body),
  });
  if (result.error) {
    const failure = { ...result.error, status: result.response.status };
    // 409 والطلب لسه شغّال نتيجته مجهولة، فالمفتاح يفضل؛ الرفض المعروف بس بيحرره.
    if (cancelOutcomeKnown(failure)) held.current = null;
    throw failure;
  }
  const parsed = cancelServiceLineResponse.safeParse(result.data);
  if (!parsed.success) throw Object.assign(parsed.error, { status: result.response.status });
  held.current = null;
  return { response: parsed.data };
}

export function useCancelServiceLine(scope: SessionServiceScope) {
  const client = useQueryClient();
  const held = useRef<Held | null>(null);
  const prefix = [
    'branch-day-sessions',
    scope.companyId,
    scope.businessId,
    scope.branchId,
    scope.userId,
  ] as const;
  return useMutation({
    mutationKey: ['cancel-service-line', scope],
    retry: false,
    gcTime: 0,
    networkMode: 'always',
    mutationFn: (attempt: CancelAttempt) => postCancellation(scope, attempt, held),
    onSuccess: (result, { sessionId, lineId }) => {
      if ('line' in result.response) {
        const { line } = result.response;
        client.setQueriesData<DayData>({ queryKey: prefix }, (current) =>
          patchCancelledLine(current, sessionId, lineId, line),
        );
      }
      void client.invalidateQueries({ queryKey: prefix });
    },
  });
}
