'use client';
import { appendServiceSessionLinesResponse } from '@pospay/contracts';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { SessionSavedDisplayFailure, type SessionAttempt } from '../model/session-attempt';
import type { SessionAttemptJournal } from '../model/session-attempt-journal';

export function useAppendServiceSessionLines(journal: SessionAttemptJournal) {
  return useMutation({
    mutationKey: ['append-service-session-lines', journal.scope], retry: false, gcTime: 0, networkMode: 'always',
    mutationFn: (attempt: Extract<SessionAttempt, { kind: 'append' }>) => journal.run(attempt, async () => {
      const result = await apiClient().POST('/v1/businesses/{businessId}/branches/{branchId}/service-sessions/{sessionId}/lines', {
        params: { header: { 'x-company-id': attempt.scope.companyId, 'Idempotency-Key': attempt.key },
          path: { businessId: attempt.scope.businessId, branchId: attempt.scope.branchId, sessionId: attempt.sessionId } }, body: attempt.body,
      });
      if (result.error) throw { ...result.error, status: result.response.status };
      const parsed = appendServiceSessionLinesResponse.safeParse(result.data);
      if (!parsed.success) {
        if (result.response.status >= 200 && result.response.status < 300) throw new SessionSavedDisplayFailure(result.response.status, result.data);
        throw Object.assign(parsed.error, { status: result.response.status });
      }
      return { status: result.response.status, data: parsed.data };
    }),
  });
}
