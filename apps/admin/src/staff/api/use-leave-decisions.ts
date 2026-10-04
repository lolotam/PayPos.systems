'use client';
import { leaveRequest, type DecideLeaveInput, type RevokeLeaveInput } from '@pospay/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
export type LeaveDecisionScope = { companyId: string; businessId: string; userId: string };
type Target = { employeeId: string; leaveId: string };
export function useLeaveDecisions(scope: LeaveDecisionScope) {
  const client = useQueryClient();
  const onSuccess = () =>
    client.invalidateQueries({
      queryKey: ['leave', scope.companyId, scope.businessId, scope.userId],
    });
  const parameters = (target: Target) => ({
    path: { businessId: scope.businessId, ...target },
    header: { 'x-company-id': scope.companyId, 'Idempotency-Key': crypto.randomUUID() },
  });
  const decide = useMutation({
    retry: false,
    mutationFn: async ({ target, input }: { target: Target; input: DecideLeaveInput }) => {
      const body =
        input.decision === 'REJECTED'
          ? input
          : {
              expected_revision: input.expected_revision,
              decision: input.decision,
              ...(input.reason === undefined ? {} : { reason: input.reason }),
            };
      const result = await apiClient().POST(
        '/v1/businesses/{businessId}/employees/{employeeId}/leave-requests/{leaveId}/decide',
        {
          params: parameters(target),
          body,
        },
      );
      if (result.error) throw result.error;
      return leaveRequest.parse(result.data);
    },
    onSuccess,
  });
  const revoke = useMutation({
    retry: false,
    mutationFn: async ({ target, input }: { target: Target; input: RevokeLeaveInput }) => {
      const result = await apiClient().POST(
        '/v1/businesses/{businessId}/employees/{employeeId}/leave-requests/{leaveId}/revoke',
        { params: parameters(target), body: input },
      );
      if (result.error) throw result.error;
      return leaveRequest.parse(result.data);
    },
    onSuccess,
  });
  return { decide, revoke };
}
