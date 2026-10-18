'use client';
import { editServiceLineResponse, type EditServiceLineInput, type EditServiceLineResponse } from '@pospay/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { apiClient } from '@/shared/api/client';
import type { SessionServiceScope } from './use-session-services';

const editPath = '/v1/businesses/{businessId}/branches/{branchId}/service-sessions/{sessionId}/lines/{lineId}';
type EditAttempt = { sessionId: string; lineId: string; body: EditServiceLineInput };
type Held = { key: string; fingerprint: string };
type PatchFailure = { ok: false; error: unknown };
type PatchSuccess = { ok: true; value: EditServiceLineResult };
export type EditServiceLineResult = { response: EditServiceLineResponse; revisionUsed: number };

// نفس المفتاح يتكرر لو الشبكة قطعت والقيم ما اتغيرتش؛ مفتاح جديد بعد النجاح أو لما الجسم يتغير.
function requestBody(body: EditServiceLineInput) {
  return {
    price: body.price, discount: body.discount, expected_revision: body.expected_revision,
    ...(body.reason === undefined ? {} : { reason: body.reason }),
    ...(body.editor_membership_id === undefined ? {} : { editor_membership_id: body.editor_membership_id }),
  };
}

function staleRevision(error: unknown, sent: number): number | null {
  if (!error || typeof error !== 'object') return null;
  const body = error as { status?: unknown; code?: unknown; details?: unknown };
  if (body.status !== 409 || body.code !== 'SESSION_LINE_REVISION_STALE' || !body.details || typeof body.details !== 'object') return null;
  const current = (body.details as { current_revision?: unknown }).current_revision;
  return typeof current === 'number' && Number.isInteger(current) && current > sent ? current : null;
}

async function patchLine(scope: SessionServiceScope, sessionId: string, lineId: string, body: EditServiceLineInput, held: { current: Held | null }): Promise<PatchSuccess | PatchFailure> {
  const fingerprint = JSON.stringify({ sessionId, lineId, body });
  const attempt = held.current?.fingerprint === fingerprint ? held.current : { key: crypto.randomUUID(), fingerprint };
  held.current = attempt;
  const result = await apiClient().PATCH(editPath, {
    params: { header: { 'x-company-id': scope.companyId, 'Idempotency-Key': attempt.key },
      path: { businessId: scope.businessId, branchId: scope.branchId, sessionId, lineId } }, body: requestBody(body),
  });
  if (result.error) return { ok: false, error: { ...result.error, status: result.response.status } };
  const parsed = editServiceLineResponse.safeParse(result.data);
  if (!parsed.success) return { ok: false, error: Object.assign(parsed.error, { status: result.response.status }) };
  held.current = null;
  return { ok: true, value: { response: parsed.data, revisionUsed: body.expected_revision } };
}

function attachRetriedRevision(error: unknown, revision: number): unknown {
  if (error !== null && typeof error === 'object') return Object.assign(error, { retriedRevision: revision });
  return Object.assign(new Error('edit retry failed'), { retriedRevision: revision });
}

// لو الـ 409 التاني أعلن مراجعة أعلى، الحفظ اليدوي يستخدمها. غير كده المراجعة اللي اتبعت تحافظ على نفس المفتاح.
export function revisionAfterFailedRetry(error: unknown): number | null {
  if (error === null || typeof error !== 'object') return null;
  const retried = (error as { retriedRevision?: unknown }).retriedRevision;
  if (typeof retried !== 'number' || !Number.isInteger(retried)) return null;
  return staleRevision(error, retried) ?? retried;
}

// 4xx رفض واضح. 409 من غير SESSION_LINE_REVISION_STALE أو FEATURE_DISABLED (إيقاف الميزة رفض نهائي مش تعارض شغّال) ممكن يكون تعارض لسه شغّال، والـ 5xx وقطع الشبكة ورد 2xx اللي مش مفهوم ممكن يكون الحفظ اتنفذ.
export function editOutcomeKnown(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const status = (error as { status?: unknown }).status;
  const code = (error as { code?: unknown }).code;
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 400 || status > 499) return false;
  if (status === 409) return code === 'SESSION_LINE_REVISION_STALE' || code === 'FEATURE_DISABLED';
  return true;
}

// محاولة واحدة زيادة لما المراجعة تتحرك؛ المفتاح بيتجدد لأن الجسم اتغير. فشل المحاولة التانية يرجع المراجعة اللي اتبعت، من غير محاولة تالتة.
async function submitEdit(scope: SessionServiceScope, attempt: EditAttempt, held: { current: Held | null }, retryStaleOnce: boolean): Promise<EditServiceLineResult> {
  const first = await patchLine(scope, attempt.sessionId, attempt.lineId, attempt.body, held);
  if (first.ok) return first.value;
  const next = retryStaleOnce ? staleRevision(first.error, attempt.body.expected_revision) : null;
  if (next === null) throw first.error;
  let second: PatchSuccess | PatchFailure;
  try {
    second = await patchLine(scope, attempt.sessionId, attempt.lineId, { ...attempt.body, expected_revision: next }, held);
  } catch (error) {
    throw attachRetriedRevision(error, next);
  }
  if (second.ok) return second.value;
  throw attachRetriedRevision(second.error, next);
}

export function useEditServiceLine(scope: SessionServiceScope, retryStaleOnce = false) {
  const client = useQueryClient();
  const held = useRef<Held | null>(null);
  return useMutation({
    mutationKey: ['edit-service-line', scope, retryStaleOnce], retry: false, gcTime: 0, networkMode: 'always',
    mutationFn: (attempt: EditAttempt) => submitEdit(scope, attempt, held, retryStaleOnce),
    onSuccess: (_data, { sessionId, lineId }) => {
      void client.invalidateQueries({ queryKey: ['branch-day-sessions', scope.companyId, scope.businessId, scope.branchId, scope.userId] });
      void client.invalidateQueries({ queryKey: ['service-line-edits', scope.companyId, scope.businessId, scope.branchId, scope.userId, sessionId, lineId] });
    },
  });
}
