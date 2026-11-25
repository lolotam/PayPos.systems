'use client';

import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { statementExportFileName } from '../model/statement-export-display';
import type { StatementScope } from './commission-statement-client';
import { downloadStatementExport } from './commission-statement-export-client';
import { saveStatementExportFile } from './download-statement-export';

/** التحصيل بياخد الملف مرة واحدة بس؛ البايتات بتتنزّل في المتصفح، والرابط المؤقت بيتلغي عند قفل الشاشة. */
export function useStatementExportDownload(
  scope: StatementScope,
  period: string,
  renderId: string | undefined,
) {
  const controller = useRef<AbortController | null>(null);
  const releases = useRef(new Set<() => void>());
  const download = useMutation({
    mutationKey: ['commission-statement-export-download', ...scope, period, renderId],
    gcTime: 0,
    retry: false,
    mutationFn: async () => {
      if (renderId === undefined) throw new Error('COMMISSION_STATEMENT_EXPORT_RENDER_MISSING');
      controller.current?.abort();
      const request = new AbortController();
      controller.current = request;
      const data = await downloadStatementExport(scope, period, renderId, request.signal);
      if (request.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      releases.current.add(saveStatementExportFile(data, statementExportFileName(period)));
    },
  });
  useEffect(() => {
    const held = releases.current;
    return () => {
      controller.current?.abort();
      for (const release of held) release();
      held.clear();
    };
  }, []);
  return download;
}
