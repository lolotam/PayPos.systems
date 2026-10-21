'use client';
import {
  changeLinePerformersResponse,
  type ChangeLinePerformersInput,
  type ChangeLinePerformersResponse,
  type ServiceSessionDayPage,
} from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useRef, type RefObject } from 'react';
import { apiClient } from '@/shared/api/client';
import { useLocale } from '@/shared/locale/locale-context';
import { performersOutcomeKnown } from '../model/change-line-performers-values';
import {
  applyPerformersChangedLine,
  type PerformersChangedSource,
} from '../model/performers-changed-day-line';
import type { SessionServiceScope } from './use-session-services';

const performersPath =
  '/v1/businesses/{businessId}/branches/{branchId}/service-sessions/{sessionId}/lines/{lineId}/performers';
type PerformersAttempt = { sessionId: string; lineId: string; body: ChangeLinePerformersInput };
type Held = { key: string; fingerprint: string };
export type UnresolvedPerformersChange = Held & PerformersAttempt;
type AttemptMemory = RefObject<Map<string, UnresolvedPerformersChange>>;
type DayData = InfiniteData<ServiceSessionDayPage>;
export type ChangeLinePerformersResult = { response: ChangeLinePerformersResponse };

function requestBody(body: ChangeLinePerformersInput) {
  return {
    performers: body.performers.map((row) => ({
      employee_id: row.employee_id,
      ...(row.share_bps === undefined ? {} : { share_bps: row.share_bps }),
    })),
    expected_revision: body.expected_revision,
    ...(body.reason === undefined ? {} : { reason: body.reason }),
    ...(body.changer_membership_id === undefined
      ? {}
      : { changer_membership_id: body.changer_membership_id }),
  };
}

function patchChangedLine(
  data: DayData | undefined,
  sessionId: string,
  lineId: string,
  next: PerformersChangedSource,
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
                line.id === lineId ? applyPerformersChangedLine(line, next) : line,
              ),
            }
          : item,
      ),
    })),
  };
}

function heldKey(
  memory: AttemptMemory | undefined,
  held: { current: Held | null },
  attempt: PerformersAttempt,
  fingerprint: string,
): { key: Held; replay: boolean } {
  const saved = memory?.current.get(attempt.lineId);
  if (saved && saved.sessionId === attempt.sessionId && saved.fingerprint === fingerprint)
    return { key: { key: saved.key, fingerprint }, replay: true };
  if (held.current?.fingerprint === fingerprint) return { key: held.current, replay: true };
  return { key: { key: crypto.randomUUID(), fingerprint }, replay: false };
}

function dropAttempt(
  memory: AttemptMemory | undefined,
  lineId: string,
  held: { current: Held | null },
) {
  held.current = null;
  memory?.current.delete(lineId);
}

// قفل الحوار بيفك التركيب؛ المفتاح بيتحفظ مع الجسم لحد ما النتيجة تتأكد، عشان الإعادة ما تعملش تغيير تاني.
// 403 على إعادة طلب نتيجته مجهولة مش معناه «ما اتحفظش»: الطلب الأول ممكن يكون اتحفظ قبل ما الصلاحية تتشال.
// فاليوم بيتجاب الأول عشان اللي ظاهر يطابق السيرفر، وبعدها بس المفتاح بيتحرر؛ لو الجلب فشل المحاولة تفضل مجهولة.
async function settleReplayRefusal(
  reconcile: () => Promise<void>,
  memory: AttemptMemory | undefined,
  lineId: string,
  held: { current: Held | null },
) {
  try {
    await reconcile();
    dropAttempt(memory, lineId, held);
  } catch {
    // المحاولة تفضل محفوظة بمفتاحها؛ فتح الحوار تاني بيرجع لحالة «النتيجة مش معروفة».
  }
}

async function putPerformers(
  scope: SessionServiceScope,
  attempt: PerformersAttempt,
  held: { current: Held | null },
  memory: AttemptMemory | undefined,
  reconcile: () => Promise<void>,
): Promise<ChangeLinePerformersResult> {
  const fingerprint = JSON.stringify(attempt);
  const { key, replay } = heldKey(memory, held, attempt, fingerprint);
  held.current = key;
  memory?.current.set(attempt.lineId, { ...key, ...attempt });
  const result = await apiClient().PUT(performersPath, {
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
  // جسم الرفض الفاضي بيوصل "" من غير envelope؛ الحالة وحدها هي اللي بتقول إن النتيجة معروفة.
  if (result.error !== undefined || result.response.status >= 400) {
    const envelope: object =
      typeof result.error === 'object' && result.error !== null ? result.error : {};
    const failure = { ...envelope, status: result.response.status };
    if (replay && failure.status === 403 && performersOutcomeKnown(failure))
      await settleReplayRefusal(reconcile, memory, attempt.lineId, held);
    else if (performersOutcomeKnown(failure)) dropAttempt(memory, attempt.lineId, held);
    throw failure;
  }
  const parsed = changeLinePerformersResponse.safeParse(result.data);
  if (!parsed.success) throw Object.assign(parsed.error, { status: result.response.status });
  dropAttempt(memory, attempt.lineId, held);
  return { response: parsed.data };
}

export function useChangeLinePerformers(
  scope: SessionServiceScope,
  memory?: AttemptMemory,
  onAccessDenied?: (message: string) => void,
) {
  const client = useQueryClient();
  const locale = useLocale();
  const held = useRef<Held | null>(null);
  const place = [scope.companyId, scope.businessId, scope.branchId, scope.userId] as const;
  return useMutation({
    mutationKey: ['change-line-performers', scope],
    retry: false,
    gcTime: 0,
    networkMode: 'always',
    mutationFn: (attempt: PerformersAttempt) =>
      putPerformers(scope, attempt, held, memory, () =>
        client.refetchQueries(
          { queryKey: ['branch-day-sessions', ...place] },
          { throwOnError: true },
        ),
      ),
    onSuccess: (result, { sessionId, lineId }) => {
      // الرد من غير line معناه إن قراءة الفرع اتشالت؛ الجلب لو فشل كان هيسيب الأسماء في الكاش.
      if (!('line' in result.response)) {
        onAccessDenied?.(t(locale, 'serviceLinePerformers.saved'));
        return;
      }
      const { line } = result.response;
      client.setQueriesData<DayData>({ queryKey: ['branch-day-sessions', ...place] }, (current) =>
        patchChangedLine(current, sessionId, lineId, line),
      );
      void client.invalidateQueries({ queryKey: ['branch-day-sessions', ...place] });
      void client.invalidateQueries({
        queryKey: ['service-line-performer-changes', ...place, sessionId, lineId],
      });
    },
  });
}
