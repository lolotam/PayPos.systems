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
  showCheckAgain: boolean;
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

function terminalMessage(
  state: 'FAILED' | 'EXPIRED' | 'CONSUMED',
  errorCode: string | undefined,
  locale: Locale,
): string {
  if (state === 'FAILED') return statementRenderCodeMessage(errorCode, locale);
  return t(
    locale,
    state === 'CONSUMED'
      ? 'attendanceStatementScreen.consumed'
      : 'attendanceStatementScreen.expired',
  );
}

function statementActions(props: Props, locale: Locale) {
  const downloadButton = (
    <Button
      onClick={props.onDownload}
      disabled={props.downloading || props.collected}
      aria-busy={props.downloading}
    >
      {t(
        locale,
        props.downloading
          ? 'attendanceStatementScreen.downloading'
          : 'attendanceStatementScreen.download',
      )}
    </Button>
  );
  const newRequest = (
    <Button variant="outline" onClick={props.onNewRequest}>
      {t(locale, 'attendanceStatementScreen.newRequest')}
    </Button>
  );
  const checkAgain = (
    <Button variant="outline" onClick={props.onCheckAgain}>
      {t(locale, 'attendanceStatementScreen.checkAgain')}
    </Button>
  );
  return { downloadButton, newRequest, checkAgain };
}

/** حالة التجهيز: الانتظار، الجاهز للتنزيل، الرفض، أو خلوص الوقت. */
export function AttendanceStatementProgress(props: Props) {
  const locale = useLocale();
  const { state, error, collected } = props;
  const message = refusalMessage(error, props.errorRoute, locale);
  const { downloadButton, newRequest, checkAgain } = statementActions(props, locale);
  if (message !== undefined) {
    return noticeRow(
      'alert',
      message,
      <>
        {props.showCheckAgain ? checkAgain : null}
        {props.showNewRequest ? newRequest : null}
      </>,
    );
  }
  if (collected || state === 'READY') {
    return noticeRow(
      'status',
      t(
        locale,
        collected ? 'attendanceStatementScreen.downloaded' : 'attendanceStatementScreen.ready',
      ),
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
  if (state === 'FAILED' || state === 'EXPIRED' || state === 'CONSUMED') {
    return noticeRow('alert', terminalMessage(state, props.errorCode, locale), newRequest);
  }
  if (props.showCheckAgain) {
    return noticeRow('status', t(locale, 'attendanceStatementScreen.timeout'), checkAgain);
  }
  if (props.waiting) {
    return <p role="status">{t(locale, 'attendanceStatementScreen.waiting')}</p>;
  }
  return null;
}
