'use client';
import type { DocumentRenderState } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import type { ReactNode } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import {
  statementErrorMessage,
  statementRenderCodeMessage,
  statementRenderErrorMessage,
} from '../model/attendance-statement-display';

type Props = {
  state: DocumentRenderState | undefined;
  errorCode: string | undefined;
  error: unknown;
  errorRoute: 'request' | 'render';
  waiting: boolean;
  timedOut: boolean;
  collected: boolean;
  downloading: boolean;
  showNewRequest: boolean;
  onDownload: () => void;
  onCheckAgain: () => void;
  onNewRequest: () => void;
};

function refusalMessage(
  error: unknown,
  route: 'request' | 'render',
  locale: Locale,
): string | undefined {
  if (!error) return undefined;
  return route === 'request'
    ? statementErrorMessage(error, locale)
    : statementRenderErrorMessage(error, locale);
}

function noticeRow(role: 'status' | 'alert', message: string, actions?: ReactNode) {
  return (
    <div role={role} className="flex flex-wrap items-center gap-2 text-sm">
      <p>{message}</p>
      {actions}
    </div>
  );
}

/** حالة التجهيز: الانتظار، الجاهز للتنزيل، الرفض، أو خلوص الوقت. */
export function AttendanceStatementProgress(props: Props) {
  const locale = useLocale();
  const { state, error, collected, downloading } = props;
  const message = refusalMessage(error, props.errorRoute, locale);
  const downloadButton = (
    <Button onClick={props.onDownload} disabled={downloading || collected} aria-busy={downloading}>
      {t(
        locale,
        downloading ? 'attendanceStatementScreen.downloading' : 'attendanceStatementScreen.download',
      )}
    </Button>
  );
  const newRequest = (
    <Button variant="outline" onClick={props.onNewRequest}>
      {t(locale, 'attendanceStatementScreen.newRequest')}
    </Button>
  );
  if (collected || state === 'READY') {
    return noticeRow(
      'status',
      t(locale, collected ? 'attendanceStatementScreen.downloaded' : 'attendanceStatementScreen.ready'),
      collected ? (
        <>
          {downloadButton}
          {newRequest}
        </>
      ) : (
        downloadButton
      ),
    );
  }
  if (message !== undefined) {
    return noticeRow('alert', message, props.showNewRequest ? newRequest : null);
  }
  if (state === 'FAILED' || state === 'EXPIRED') {
    const failure =
      state === 'FAILED'
        ? statementRenderCodeMessage(props.errorCode, locale)
        : t(locale, 'attendanceStatementScreen.expired');
    return noticeRow('alert', failure, state === 'EXPIRED' ? newRequest : null);
  }
  if (props.timedOut) {
    return noticeRow(
      'status',
      t(locale, 'attendanceStatementScreen.timeout'),
      <Button variant="outline" onClick={props.onCheckAgain}>
        {t(locale, 'attendanceStatementScreen.checkAgain')}
      </Button>,
    );
  }
  if (props.waiting) {
    return <p role="status">{t(locale, 'attendanceStatementScreen.waiting')}</p>;
  }
  return null;
}
