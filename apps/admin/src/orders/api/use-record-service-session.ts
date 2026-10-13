'use client';
import { recordServiceSessionResponse } from '@pospay/contracts';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { SessionSavedDisplayFailure, type SessionAttempt } from '../model/session-attempt';
import type { SessionAttemptJournal } from '../model/session-attempt-journal';

export function useRecordServiceSession(journal: SessionAttemptJournal) {
  return useMutation({
    mutationKey: ['record-service-session', journal.scope], retry: false, gcTime: 0, networkMode: 'always',
    mutationFn: (attempt: Extract<SessionAttempt, { kind: 'record' }>) => journal.run(attempt, async () => {
      const result = await apiClient().POST('/v1/businesses/{businessId}/branches/{branchId}/service-sessions', {
        params: { header: { 'x-company-id': attempt.scope.companyId, 'Idempotency-Key': attempt.key },
          path: { businessId: attempt.scope.businessId, branchId: attempt.scope.branchId } }, body: attempt.body,
      });
      if (result.error) throw { ...result.error, status: result.response.status };
      const parsed = recordServiceSessionResponse.safeParse(result.data);
      if (!parsed.success) {
        if (result.response.status >= 200 && result.response.status < 300) throw new SessionSavedDisplayFailure(result.response.status, result.data);
        throw Object.assign(parsed.error, { status: result.response.status });
      }
      return { status: result.response.status, data: parsed.data };
    }),
  });
}
