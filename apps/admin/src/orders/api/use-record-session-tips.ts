'use client';
import { sessionTips, type RecordSessionTipsInput, type SessionTips } from '@pospay/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, type RefObject } from 'react';
import { apiClient } from '@/shared/api/client';
import { tipOutcomeKnown } from '../model/session-tip-outcome';
import { sessionTipsKey, sessionTipsPath } from './use-session-tips';
import type { SessionServiceScope } from './use-session-services';

type Held = { key: string; fingerprint: string };
export type UnresolvedTip = Held & { sessionId: string; body: RecordSessionTipsInput };
type AttemptMemory = RefObject<Map<string, UnresolvedTip>>;
type Attempt = { sessionId: string; body: RecordSessionTipsInput };

function requestBody(body: RecordSessionTipsInput) {
  return {
    expected_revision: body.expected_revision,
    tips: body.tips,
    ...(body.reason === undefined ? {} : { reason: body.reason }),
    ...(body.recorder_membership_id === undefined
      ? {}
      : { recorder_membership_id: body.recorder_membership_id }),
  };
}

function remembered(memory: AttemptMemory | undefined, sessionId: string, fingerprint: string) {
  const saved = memory?.current.get(sessionId);
  if (!saved || saved.fingerprint !== fingerprint) return null;
  return { key: saved.key, fingerprint };
}

function keep(memory: AttemptMemory | undefined, attempt: Attempt, held: Held) {
  memory?.current.set(attempt.sessionId, {
    ...held,
    sessionId: attempt.sessionId,
    body: attempt.body,
  });
}

function drop(
  memory: AttemptMemory | undefined,
  sessionId: string,
  held: { current: Held | null },
) {
  held.current = null;
  memory?.current.delete(sessionId);
}

function attemptKey(
  memory: AttemptMemory | undefined,
  attempt: Attempt,
  fingerprint: string,
  held: { current: Held | null },
) {
  return (
    remembered(memory, attempt.sessionId, fingerprint) ??
    (held.current?.fingerprint === fingerprint
      ? held.current
      : { key: crypto.randomUUID(), fingerprint })
  );
}

async function putTips(
  scope: SessionServiceScope,
  attempt: Attempt,
  held: { current: Held | null },
  memory: AttemptMemory | undefined,
): Promise<SessionTips> {
  const body = requestBody(attempt.body);
  const fingerprint = JSON.stringify({ sessionId: attempt.sessionId, body });
  const key = attemptKey(memory, attempt, fingerprint, held);
  held.current = key;
  keep(memory, attempt, key);
  try {
    const saved = await sendTips(scope, attempt.sessionId, key.key, body);
    drop(memory, attempt.sessionId, held);
    return saved;
  } catch (error) {
    if (tipOutcomeKnown(error)) drop(memory, attempt.sessionId, held);
    throw error;
  }
}

async function sendTips(
  scope: SessionServiceScope,
  sessionId: string,
  key: string,
  body: ReturnType<typeof requestBody>,
): Promise<SessionTips> {
  const result = await apiClient().PUT(sessionTipsPath, {
    params: {
      header: { 'x-company-id': scope.companyId, 'Idempotency-Key': key },
      path: { businessId: scope.businessId, branchId: scope.branchId, sessionId },
    },
    body,
  });
  if (result.error) throw { ...result.error, status: result.response.status };
  const parsed = sessionTips.safeParse(result.data);
  if (!parsed.success) throw Object.assign(parsed.error, { status: result.response.status });
  return parsed.data;
}

export function useRecordSessionTips(scope: SessionServiceScope, memory?: AttemptMemory) {
  const client = useQueryClient();
  const held = useRef<Held | null>(null);
  return useMutation({
    mutationKey: ['record-session-tips', scope],
    retry: false,
    gcTime: 0,
    networkMode: 'always',
    mutationFn: (attempt: Attempt) => putTips(scope, attempt, held, memory),
    onSuccess: (data, { sessionId }) => {
      client.setQueryData(sessionTipsKey(scope, sessionId), data);
    },
  });
}
