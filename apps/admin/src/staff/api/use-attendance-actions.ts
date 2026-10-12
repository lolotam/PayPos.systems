'use client';
import {
  attendanceExceptionRecord,
  attendanceExceptionDecisionInput,
  correctAttendanceInput,
  correctAttendanceResult,
  attendanceChangeRequestInput,
  attendanceChangeRequest,
  attendanceChangeDecisionResult,
  decideAttendanceChangeInput,
  cancelAttendanceChangeInput,
  type AttendanceExceptionDecisionInput,
  type CorrectAttendanceInput,
  type AttendanceChangeRequestInput,
  type DecideAttendanceChangeInput,
  type CancelAttendanceChangeInput,
} from '@pospay/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import type { AttendanceBoardScope } from './use-attendance-board';
import { attendanceActionParams } from './use-attendance-actions-read';

function useAttendanceWriteContext(scope: AttendanceBoardScope) {
  const client = useQueryClient();
  const onSuccess = () =>
    Promise.all([
      client.invalidateQueries({
        queryKey: ['attendance-actions', scope.companyId, scope.businessId],
      }),
      client.invalidateQueries({
        queryKey: ['attendance-board', scope.companyId, scope.businessId],
      }),
      client.invalidateQueries({
        queryKey: ['attendance-report', scope.companyId, scope.businessId],
      }),
    ]);
  const params = () => ({
    ...attendanceActionParams(scope),
    header: { 'x-company-id': scope.companyId, 'Idempotency-Key': crypto.randomUUID() },
  });
  return { params, onSuccess };
}
function useAttendanceException(scope: AttendanceBoardScope) {
  const { params, onSuccess } = useAttendanceWriteContext(scope);
  const exception = useMutation({
    retry: false,
    onSuccess,
    mutationFn: async ({
      id,
      action,
      input,
    }: {
      id: string;
      action: 'resolve' | 'reopen';
      input: AttendanceExceptionDecisionInput;
    }) => {
      const body = attendanceExceptionDecisionInput.parse(input);
      const path =
        action === 'resolve'
          ? ('/v1/businesses/{businessId}/attendance-exceptions/{exceptionId}/resolve' as const)
          : ('/v1/businesses/{businessId}/attendance-exceptions/{exceptionId}/reopen' as const);
      const result = await apiClient().POST(path, {
        params: { ...params(), path: { businessId: scope.businessId, exceptionId: id } },
        body,
      });
      if (result.error) throw { ...result.error, status: result.response.status };
      return attendanceExceptionRecord.parse(result.data);
    },
  });
  return exception;
}

function useAttendanceCorrect(scope: AttendanceBoardScope) {
  const { params, onSuccess } = useAttendanceWriteContext(scope);
  const correct = useMutation({
    retry: false,
    onSuccess,
    mutationFn: async ({ id, input }: { id: string; input: CorrectAttendanceInput }) => {
      const body = correctAttendanceInput.parse(input);
      const result = await apiClient().POST(
        '/v1/businesses/{businessId}/attendance-sessions/{sessionId}/correct',
        {
          params: { ...params(), path: { businessId: scope.businessId, sessionId: id } },
          body: {
            revision: body.revision,
            reason: body.reason,
            ...(body.clock_in ? { clock_in: body.clock_in } : {}),
            ...(body.clock_out ? { clock_out: body.clock_out } : {}),
          },
        },
      );
      if (result.error) throw { ...result.error, status: result.response.status };
      return correctAttendanceResult.parse(result.data);
    },
  });
  return correct;
}

function useAttendanceRequest(scope: AttendanceBoardScope) {
  const { params, onSuccess } = useAttendanceWriteContext(scope);
  const request = useMutation({
    retry: false,
    onSuccess,
    mutationFn: async (input: AttendanceChangeRequestInput) => {
      const result = await apiClient().POST(
        '/v1/businesses/{businessId}/attendance-change-requests',
        {
          params: params(),
          body: attendanceChangeRequestInput.parse(input),
        },
      );
      if (result.error) throw { ...result.error, status: result.response.status };
      return attendanceChangeRequest.parse(result.data);
    },
  });
  return request;
}

function useAttendanceDecide(scope: AttendanceBoardScope) {
  const { params, onSuccess } = useAttendanceWriteContext(scope);
  const decide = useMutation({
    retry: false,
    onSuccess,
    mutationFn: async ({ id, input }: { id: string; input: DecideAttendanceChangeInput }) => {
      const body = decideAttendanceChangeInput.parse(input);
      const result = await apiClient().POST(
        '/v1/businesses/{businessId}/attendance-change-requests/{requestId}/decide',
        {
          params: { ...params(), path: { businessId: scope.businessId, requestId: id } },
          body:
            body.decision === 'REJECTED'
              ? body
              : {
                  decision: body.decision,
                  revision: body.revision,
                  ...(body.reason ? { reason: body.reason } : {}),
                },
        },
      );
      if (result.error) throw { ...result.error, status: result.response.status };
      return attendanceChangeDecisionResult.parse(result.data);
    },
  });
  return decide;
}

function useAttendanceCancel(scope: AttendanceBoardScope) {
  const { params, onSuccess } = useAttendanceWriteContext(scope);
  const cancel = useMutation({
    retry: false,
    onSuccess,
    mutationFn: async ({ id, input }: { id: string; input: CancelAttendanceChangeInput }) => {
      const result = await apiClient().POST(
        '/v1/businesses/{businessId}/attendance-change-requests/{requestId}/cancel',
        {
          params: { ...params(), path: { businessId: scope.businessId, requestId: id } },
          body: cancelAttendanceChangeInput.parse(input),
        },
      );
      if (result.error) throw { ...result.error, status: result.response.status };
      return attendanceChangeRequest.parse(result.data);
    },
  });
  return cancel;
}

export function useAttendanceActions(scope: AttendanceBoardScope) {
  const exception = useAttendanceException(scope);
  const correct = useAttendanceCorrect(scope);
  const request = useAttendanceRequest(scope);
  const decide = useAttendanceDecide(scope);
  const cancel = useAttendanceCancel(scope);
  return { exception, correct, request, decide, cancel };
}
