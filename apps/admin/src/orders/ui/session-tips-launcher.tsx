'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useRef, useState, type RefObject } from 'react';
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
  onForbidden,
  disabled = false,
  memory,
  netsKnown = true,
}: {
  scope: SessionServiceScope;
  sessionId: string;
  lines: readonly TipSourceLine[];
  online: boolean;
  onAccessDenied: (message: string) => void;
  onForbidden?: (message: string) => void;
  disabled?: boolean;
  memory?: RefObject<Map<string, UnresolvedTip>>;
  netsKnown?: boolean;
}) {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const ownMemory = useRef(new Map<string, UnresolvedTip>());
  const attempts = memory ?? ownMemory;
  if (hidden) return null;
  const refuse = (message: string) => {
    setHidden(true);
    setOpen(false);
    onForbidden?.(message);
  };
  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => {
          if (!disabled) setOpen(true);
        }}
      >
        {t(locale, 'sessionTips.open')}
      </Button>
      {open ? (
        <SessionTipsDialog
          scope={scope}
          sessionId={sessionId}
          lines={lines}
          online={online}
          netsKnown={netsKnown}
          memory={attempts}
          onAccessDenied={onAccessDenied}
          onForbidden={refuse}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
