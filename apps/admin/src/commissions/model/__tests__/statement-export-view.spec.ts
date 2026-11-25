import { t } from '@pospay/i18n';
import { expect, it } from 'vitest';
import { exportFailureText, statementExportFileName } from '../statement-export-display';
import { exportView, type ExportViewInput } from '../statement-export-view';

const WAITING: ExportViewInput = {
  renderId: 'render-1',
  requestPending: false,
  requestError: null,
  state: 'QUEUED',
  renderErrorCode: undefined,
  statusError: null,
  timedOut: false,
  downloadError: null,
  collected: false,
};

it('shows the timeout recovery once polling gave up on a render that never finished', () => {
  expect(exportView({ ...WAITING, timedOut: true }, 'en')).toEqual({ kind: 'timeout' });
  expect(exportView({ ...WAITING, state: 'READY', timedOut: true }, 'en')).toEqual({
    kind: 'ready',
  });
});

it('never leaks a raw error code, in either language, even for an unknown one', () => {
  for (const locale of ['en', 'ar'] as const) {
    const text = exportFailureText({ code: 'SOMETHING_NEW', status: 500 }, locale);
    expect(text).toBe(t(locale, 'commissionStatementScreen.exportErrGeneric'));
    expect(text).not.toContain('SOMETHING_NEW');
  }
});

it('names the file after the month and reads the unavailable code in Arabic', () => {
  expect(statementExportFileName('2026-10')).toBe('commission-statement-2026-10.xlsx');
  expect(exportFailureText({ code: 'COMMISSION_STATEMENT_UNAVAILABLE' }, 'ar')).toContain(
    'كشف العمولة',
  );
});
