'use client';
import {
  cancelServiceLineResponse,
  type CancelServiceLineInput,
  type CancelServiceLineResponse,
  type ServiceSessionDayPage,
} from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useRef, type RefObject } from 'react';
import { apiClient } from '@/shared/api/client';
import { useLocale } from '@/shared/locale/locale-context';
import { cancelOutcomeKnown } from '../model/cancel-service-line-values';
import { applyCancelledLine, type CancelledDaySource } from '../model/cancelled-day-line';
import { editAccessRevoked } from '../model/service-session-access';
import type { SessionServiceScope } from './use-session-services';

const cancelPath =
  '/v1/businesses/{businessId}/branches/{branchId}/service-sessions/{sessionId}/lines/{lineId}/cancellation';
type CancelAttempt = { sessionId: string; lineId: string; body: CancelServiceLineInput };
type Held = { key: string; fingerprint: string };
export type UnresolvedCancel = Held & {
  sessionId: string;
  lineId: string;
  body: CancelServiceLineInput;
};
type AttemptMemory = RefObject<Map<string, UnresolvedCancel>>;
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

function rememberedKey(
  memory: AttemptMemory | undefined,
  attempt: CancelAttempt,
  fingerprint: string,
) {
  const saved = memory?.current.get(attempt.lineId);
  if (!saved || saved.sessionId !== attempt.sessionId || saved.fingerprint !== fingerprint)
    return null;
  return { key: saved.key, fingerprint };
}

// قفل الحوار بيفك التركيب وبيضيّع المرجع؛ المحاولة بتتحفظ بالمفتاح لحد ما النتيجة تتأكد.
function keepAttempt(memory: AttemptMemory | undefined, attempt: CancelAttempt, held: Held) {
  memory?.current.set(attempt.lineId, {
    ...held,
    sessionId: attempt.sessionId,
    lineId: attempt.lineId,
    body: attempt.body,
  });
}

function dropAttempt(
  memory: AttemptMemory | undefined,
  lineId: string,
  held: { current: Held | null },
) {
  held.current = null;
  memory?.current.delete(lineId);
}

async function postCancellation(
  scope: SessionServiceScope,
  attempt: CancelAttempt,
  held: { current: Held | null },
  memory: AttemptMemory | undefined,
): Promise<CancelServiceLineResult> {
  const fingerprint = JSON.stringify({
    sessionId: attempt.sessionId,
    lineId: attempt.lineId,
    body: attempt.body,
  });
  const key =
    rememberedKey(memory, attempt, fingerprint) ??
    (held.current?.fingerprint === fingerprint
      ? held.current
      : { key: crypto.randomUUID(), fingerprint });
  held.current = key;
  keepAttempt(memory, attempt, key);
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
    if (cancelOutcomeKnown(failure)) dropAttempt(memory, attempt.lineId, held);
    throw failure;
  }
  const parsed = cancelServiceLineResponse.safeParse(result.data);
  if (!parsed.success) throw Object.assign(parsed.error, { status: result.response.status });
  dropAttempt(memory, attempt.lineId, held);
  return { response: parsed.data };
}

// 403 المعروف معناه إن صلاحية الإلغاء اتشالت من الفرع؛ إعادة قراءة القدرة بتخفي الزرار من كل السطور وقائمة اليوم تفضل.
function cancelBranchForbidden(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const status = (error as { status?: unknown }).status;
  return status === 403 && !editAccessRevoked(error);
}

export function useCancelServiceLine(
  scope: SessionServiceScope,
  memory?: AttemptMemory,
  onAccessDenied?: (message: string) => void,
) {
  const client = useQueryClient();
  const locale = useLocale();
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
    mutationFn: (attempt: CancelAttempt) => postCancellation(scope, attempt, held, memory),
    onSuccess: (result, { sessionId, lineId }) => {
      // الرد من غير line معناه إن قراءة الفرع اتشالت؛ الجلب لو فشل كان هيسيب الأسماء والأسعار في الكاش.
      if (!('line' in result.response)) {
        onAccessDenied?.(t(locale, 'serviceLineCancel.saved'));
        return;
      }
      const { line } = result.response;
      client.setQueriesData<DayData>({ queryKey: prefix }, (current) =>
        patchCancelledLine(current, sessionId, lineId, line),
      );
      void client.invalidateQueries({ queryKey: prefix });
    },
    onError: (error) => {
      if (!cancelBranchForbidden(error)) return;
      void client.invalidateQueries({
        queryKey: [
          'service-session-capabilities',
          scope.companyId,
          scope.businessId,
          scope.branchId,
          scope.userId,
        ],
      });
    },
  });
}
