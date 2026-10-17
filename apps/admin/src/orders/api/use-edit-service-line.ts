'use client';
import { editServiceLineResponse, type EditServiceLineInput } from '@pospay/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { apiClient } from '@/shared/api/client';
import type { SessionServiceScope } from './use-session-services';

const editPath = '/v1/businesses/{businessId}/branches/{branchId}/service-sessions/{sessionId}/lines/{lineId}';
type EditAttempt = { sessionId: string; lineId: string; body: EditServiceLineInput };

// نفس المفتاح يتكرر لو الشبكة قطعت والقيم ما اتغيرتش؛ مفتاح جديد بعد النجاح أو لما الجسم يتغير.
export function useEditServiceLine(scope: SessionServiceScope) {
  const client = useQueryClient();
  const held = useRef<{ key: string; fingerprint: string } | null>(null);
  return useMutation({
    mutationKey: ['edit-service-line', scope], retry: false, gcTime: 0, networkMode: 'always',
    mutationFn: async ({ sessionId, lineId, body }: EditAttempt) => {
      const fingerprint = JSON.stringify({ sessionId, lineId, body });
      const attempt = held.current?.fingerprint === fingerprint ? held.current : { key: crypto.randomUUID(), fingerprint };
      held.current = attempt;
      const payload = {
        price: body.price, discount: body.discount, expected_revision: body.expected_revision,
        ...(body.reason === undefined ? {} : { reason: body.reason }),
        ...(body.editor_membership_id === undefined ? {} : { editor_membership_id: body.editor_membership_id }),
      };
      const result = await apiClient().PATCH(editPath, {
        params: { header: { 'x-company-id': scope.companyId, 'Idempotency-Key': attempt.key },
          path: { businessId: scope.businessId, branchId: scope.branchId, sessionId, lineId } }, body: payload,
      });
      if (result.error) throw { ...result.error, status: result.response.status };
      const parsed = editServiceLineResponse.safeParse(result.data);
      if (!parsed.success) throw Object.assign(parsed.error, { status: result.response.status });
      held.current = null;
      return parsed.data;
    },
    onSuccess: (_data, { sessionId, lineId }) => {
      void client.invalidateQueries({ queryKey: ['branch-day-sessions', scope.companyId, scope.businessId, scope.branchId, scope.userId] });
      void client.invalidateQueries({ queryKey: ['service-line-edits', scope.companyId, scope.businessId, scope.branchId, scope.userId, sessionId, lineId] });
    },
  });
}
