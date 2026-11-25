'use client';

import type { DocumentRenderState } from '@pospay/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { StatementScope } from './commission-statement-client';
import {
  fetchStatementExportStatus,
  type StatementExportStatus,
} from './commission-statement-export-client';

export const EXPORT_POLL_INTERVAL_MS = 2_000;
export const EXPORT_POLL_DEADLINE_MS = 60_000;

const TERMINAL_STATES: readonly DocumentRenderState[] = ['READY', 'FAILED', 'EXPIRED', 'CONSUMED'];

/**
 * يتابع حالة تجهيز الملف كل ثانيتين لحد 60 ثانية؛ بعدها الشاشة بتوقف وتعرض «اتأكد تاني».
 * كل طلب بيستهلك من حد الطلبات في الـ API، فالتابع ما بيعيدش الطلب لوحده بعد المهلة.
 */
export function useStatementExportStatus(
  scope: StatementScope,
  period: string,
  renderId: string | undefined,
) {
  const key = `${scope.join(':')}:${period}:${renderId ?? ''}`;
  const [deadlineKey, setDeadlineKey] = useState<string>();
  const expired = deadlineKey === key;
  useEffect(() => {
    if (renderId === undefined) return;
    const timer = setTimeout(() => setDeadlineKey(key), EXPORT_POLL_DEADLINE_MS);
    return () => clearTimeout(timer);
  }, [key, renderId]);
  const query = useQuery<StatementExportStatus>({
    queryKey: ['commission-statement-export-status', ...scope, period, renderId],
    enabled: renderId !== undefined,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (current) => {
      const state = current.state.data?.state;
      const error = current.state.error as { status?: unknown } | null;
      if (error?.status === 404 || expired) return false;
      if (state !== undefined && TERMINAL_STATES.includes(state)) return false;
      return EXPORT_POLL_INTERVAL_MS;
    },
    queryFn: ({ signal }) => {
      if (renderId === undefined) throw new Error('COMMISSION_STATEMENT_EXPORT_RENDER_MISSING');
      return fetchStatementExportStatus(scope, period, renderId, signal);
    },
  });
  const state = query.data?.state;
  const terminal = state !== undefined && TERMINAL_STATES.includes(state);
  return { ...query, timedOut: expired && !terminal };
}
