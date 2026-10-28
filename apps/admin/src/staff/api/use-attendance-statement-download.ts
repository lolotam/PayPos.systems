'use client';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { apiClient } from '@/shared/api/client';
import {
  statementFileName,
  statementPeriod,
  type StatementDraft,
} from '../model/attendance-statement-display';
import { downloadAttendanceStatement } from './download-attendance-statement';
import type { AttendanceStatementScope } from './use-attendance-statement-request';

/** خطأ التحصيل بيرجع كـ blob مع الاستجابة، فبنفكّه عشان نعرف كود الرفض. */
async function blobError(error: unknown, status: number) {
  let envelope = error;
  const blob = error as { text?: () => Promise<string> } | null;
  if (typeof blob?.text === 'function') {
    try {
      envelope = JSON.parse(await blob.text()) as unknown;
    } catch {
      envelope = null;
    }
  }
  return {
    ...(typeof envelope === 'object' && envelope !== null ? envelope : {}),
    status,
  };
}

/** التحصيل بياخد الملف مرة واحدة بس (Story 4.1)؛ البايتات بتتخزن في المتصفح لحد ما تتحمّل. */
export function useAttendanceStatementDownload(
  scope: AttendanceStatementScope,
  renderId: string | undefined,
  draft: StatementDraft,
) {
  const { companyId, businessId, branchId, userId } = scope;
  const fileName = statementFileName(draft.form, statementPeriod(draft));
  const controller = useRef<AbortController | null>(null);
  const downloads = useRef(new Set<() => void>());
  const download = useMutation({
    mutationKey: [
      'attendance-statement-download',
      companyId,
      businessId,
      userId,
      branchId,
      renderId,
    ],
    gcTime: 0,
    retry: false,
    mutationFn: async () => {
      if (renderId === undefined) throw new Error('ATTENDANCE_STATEMENT_RENDER_MISSING');
      controller.current?.abort();
      const request = new AbortController();
      controller.current = request;
      const result = await apiClient().POST(
        '/v1/businesses/{businessId}/branches/{branchId}/attendance-statements/{renderId}/download',
        {
          params: {
            header: { 'x-company-id': companyId },
            path: { businessId, branchId, renderId },
          },
          parseAs: 'blob',
          signal: request.signal,
        },
      );
      if (request.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (result.error) throw await blobError(result.error, result.response.status);
      if (!result.data) throw new Error('ATTENDANCE_STATEMENT_EMPTY_RESPONSE');
      downloads.current.add(downloadAttendanceStatement(result.data, fileName));
    },
  });
  useEffect(() => {
    const releases = downloads.current;
    return () => {
      controller.current?.abort();
      for (const release of releases) release();
      releases.clear();
    };
  }, []);
  return download;
}
