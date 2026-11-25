'use client';

import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import type { ReactNode } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import type { ExportRecovery, ExportView } from '../model/statement-export-view';

const NS = 'commissionStatementScreen';

/** زرار في حوار التصدير بنص من كتالوج الشاشة؛ المقفول بيعلّم نفسه مشغول. */
function Action({
  label,
  onClick,
  outline = false,
  busy = false,
}: {
  label: 'exportStart' | 'exportDownload' | 'exportDownloading' | 'exportCheckAgain' | 'exportNew';
  onClick(): void;
  outline?: boolean;
  busy?: boolean;
}) {
  const locale = useLocale();
  return (
    <Button
      variant={outline ? 'outline' : 'primary'}
      onClick={onClick}
      disabled={busy}
      aria-busy={busy}
    >
      {t(locale, `${NS}.${label}`)}
    </Button>
  );
}

function Row({
  role,
  text,
  children,
}: {
  role: 'status' | 'alert';
  text: string;
  children: ReactNode;
}) {
  return (
    <div role={role} className="flex flex-wrap items-center gap-2">
      <p>{text}</p>
      {children}
    </div>
  );
}

/** الأزرار اللي بتتعرض جنب رسالة الفشل حسب طريقة التعافي؛ التصدير الجديد متاح دايمًا ما عدا لما البدء نفسه هو الحل. */
function recoveryActions(
  recovery: ExportRecovery,
  buttons: Record<'start' | 'check' | 'download' | 'fresh', ReactNode>,
): ReactNode {
  if (recovery === 'start') return buttons.start;
  if (recovery === 'new') return buttons.fresh;
  return (
    <>
      {recovery === 'check' ? buttons.check : buttons.download}
      {buttons.fresh}
    </>
  );
}

/** مكان رسالة الحالة وأزرار الاستمرار في حوار التصدير؛ الرسالة جاهزة ومفيش كود خام بيتعرض. */
export function StatementExportProgress({
  view,
  downloading,
  onStart,
  onDownload,
  onCheckAgain,
  onNew,
}: {
  view: ExportView;
  downloading: boolean;
  onStart(): void;
  onDownload(): void;
  onCheckAgain(): void;
  onNew(): void;
}) {
  const locale = useLocale();
  const download = (
    <Action
      label={downloading ? 'exportDownloading' : 'exportDownload'}
      busy={downloading}
      onClick={onDownload}
    />
  );
  const fresh = <Action label="exportNew" outline onClick={onNew} />;
  const start = <Action label="exportStart" onClick={onStart} />;
  const check = <Action label="exportCheckAgain" outline onClick={onCheckAgain} />;
  switch (view.kind) {
    case 'idle':
      return start;
    case 'waiting':
      return <p role="status">{t(locale, `${NS}.exportWaiting`)}</p>;
    case 'timeout':
      return (
        <Row role="status" text={t(locale, `${NS}.exportTimeout`)}>
          {check}
        </Row>
      );
    case 'ready':
      return (
        <Row role="status" text={t(locale, `${NS}.exportReady`)}>
          {download}
        </Row>
      );
    case 'downloaded':
      return (
        <Row role="status" text={t(locale, `${NS}.exportDownloaded`)}>
          {fresh}
        </Row>
      );
    case 'failed':
      return (
        <Row role="alert" text={view.text}>
          {recoveryActions(view.recovery, { start, check, download, fresh })}
        </Row>
      );
  }
}
