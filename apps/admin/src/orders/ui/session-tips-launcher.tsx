'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useRef, useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import type { UnresolvedTip } from '../api/use-record-session-tips';
import type { SessionServiceScope } from '../api/use-session-services';
import type { TipSourceLine } from '../model/session-tip-source';
import { SessionTipsDialog } from './session-tips-dialog';

export function SessionTipsLauncher({
  scope,
  sessionId,
  lines,
  online,
  onAccessDenied,
}: {
  scope: SessionServiceScope;
  sessionId: string;
  lines: readonly TipSourceLine[];
  online: boolean;
  onAccessDenied: (message: string) => void;
}) {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const memory = useRef(new Map<string, UnresolvedTip>());
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        {t(locale, 'sessionTips.open')}
      </Button>
      {open ? (
        <SessionTipsDialog
          scope={scope}
          sessionId={sessionId}
          lines={lines}
          online={online}
          memory={memory}
          onAccessDenied={onAccessDenied}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
