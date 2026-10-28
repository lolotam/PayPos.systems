'use client';
import {
  attendanceStatementStatus,
  type AttendanceStatementStatus,
  type DocumentRenderState,
} from '@pospay/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiClient } from '@/shared/api/client';
import type { AttendanceStatementScope } from './use-attendance-statement-request';

export const STATEMENT_POLL_INTERVAL_MS = 2_000;
export const STATEMENT_POLL_DEADLINE_MS = 60_000;

const TERMINAL_STATES: readonly DocumentRenderState[] = ['READY', 'FAILED', 'EXPIRED', 'CONSUMED'];

/**
 * يتابع حالة التجهيز كل ثانيتين لحد 60 ثانية؛ بعدها الشاشة بتوقف وتعرض «تحقق تاني».
 * السبب إن كل طلب بيستهلك من حد الساعة في الـ API، فالتابع ما بيعيدش الطلب لوحده (FR-008).
 */
export function useAttendanceStatementStatus(
  scope: AttendanceStatementScope,
  renderId: string | undefined,
  enabled = true,
) {
  const { companyId, businessId, branchId, userId } = scope;
  const key = `${companyId}:${businessId}:${userId}:${branchId}:${renderId ?? ''}`;
  const [deadlineScope, setDeadlineScope] = useState<string>();
  const expired = deadlineScope === key;
  useEffect(() => {
    if (renderId === undefined) return;
    const timer = setTimeout(() => setDeadlineScope(key), STATEMENT_POLL_DEADLINE_MS);
    return () => clearTimeout(timer);
  }, [key, renderId]);
  const query = useQuery<AttendanceStatementStatus>({
    queryKey: ['attendance-statement-status', companyId, businessId, userId, branchId, renderId],
    enabled: enabled && renderId !== undefined,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (current) => {
      const state = current.state.data?.state;
      if (expired) return false;
      if (state !== undefined && TERMINAL_STATES.includes(state)) return false;
      return STATEMENT_POLL_INTERVAL_MS;
    },
    queryFn: async ({ signal }) => {
      if (renderId === undefined) throw new Error('ATTENDANCE_STATEMENT_RENDER_MISSING');
      const result = await apiClient().GET(
        '/v1/businesses/{businessId}/branches/{branchId}/attendance-statements/{renderId}',
        {
          params: {
            header: { 'x-company-id': companyId },
            path: { businessId, branchId, renderId },
          },
          signal,
        },
      );
      if (result.error) throw { ...result.error, status: result.response.status };
      return attendanceStatementStatus.parse(result.data);
    },
  });
  const state = query.data?.state;
  const terminal = state !== undefined && TERMINAL_STATES.includes(state);
  return { ...query, timedOut: expired && !terminal };
}
