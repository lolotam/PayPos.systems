'use client';

import { useMutation } from '@tanstack/react-query';
import type { StatementScope } from './commission-statement-client';
import {
  requestStatementExport,
  type StatementExportLanguage,
} from './commission-statement-export-client';

/** طلب التصدير: السيرفر بيجاوب 202 بمعرّف التجهيز والملف بيتجهّز في الخلفية؛ مفيش إعادة محاولة تلقائية. */
export function useStatementExportRequest(scope: StatementScope, period: string) {
  return useMutation({
    mutationKey: ['commission-statement-export-request', ...scope, period],
    gcTime: 0,
    retry: false,
    mutationFn: (language: StatementExportLanguage) =>
      requestStatementExport(scope, period, language),
  });
}
