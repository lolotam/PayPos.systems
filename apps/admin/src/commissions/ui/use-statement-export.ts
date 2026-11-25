'use client';

import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import type { StatementScope } from '../api/commission-statement-client';
import type { StatementExportLanguage } from '../api/commission-statement-export-client';
import { useStatementExportDownload } from '../api/use-statement-export-download';
import { useStatementExportRequest } from '../api/use-statement-export-request';
import { useStatementExportStatus } from '../api/use-statement-export-status';
import { exportView } from '../model/statement-export-view';

/**
 * حالة حوار التصدير كلها في مكان واحد: لغة الملف (الافتراضي لغة الشاشة)، والطلب، ومتابعة التجهيز، والتحميل.
 * اللغة بتتقفل من أول طلب لحد «تصدير جديد»، لأن الطلب المحفوظ على السيرفر ما بيتغيّرش بعدها.
 */
export function useStatementExport(scope: StatementScope, period: string) {
  const locale = useLocale();
  const [language, setLanguage] = useState<StatementExportLanguage>(locale);
  const request = useStatementExportRequest(scope, period);
  const renderId = request.data;
  const status = useStatementExportStatus(scope, period, renderId);
  const download = useStatementExportDownload(scope, period, renderId);
  const view = exportView(
    {
      renderId,
      requestPending: request.isPending,
      requestError: request.error,
      state: status.data?.state,
      renderErrorCode: status.data?.error_code,
      statusError: status.error,
      timedOut: status.timedOut,
      downloadError: download.error,
      collected: download.isSuccess,
    },
    locale,
  );
  return {
    language,
    setLanguage,
    view,
    locked: renderId !== undefined || request.isPending,
    busy: request.isPending || download.isPending,
    downloading: download.isPending,
    start: () => {
      download.reset();
      request.mutate(language);
    },
    download: () => download.mutate(),
    checkAgain: () => void status.refetch(),
    startNew: () => {
      request.reset();
      download.reset();
    },
  };
}
