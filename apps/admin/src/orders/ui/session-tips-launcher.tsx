'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useRef, useState, type RefObject } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import type { UnresolvedTip } from '../api/use-record-session-tips';
import type { SessionServiceScope } from '../api/use-session-services';
import type { TipSourceLine } from '../model/session-tip-source';
import { SessionTipsDialog } from './session-tips-dialog';

type SessionTipsLauncherProps = {
  scope: SessionServiceScope;
  sessionId: string;
  lines: readonly TipSourceLine[];
  online: boolean;
  onAccessDenied: (message: string) => void;
  onForbidden?: (message: string) => void;
  disabled?: boolean;
  memory?: RefObject<Map<string, UnresolvedTip>>;
  netsKnown?: boolean;
};

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
}: SessionTipsLauncherProps) {
  const locale = useLocale();
  const [openForSession, setOpenForSession] = useState<string | null>(null);
  const [hiddenForSession, setHiddenForSession] = useState<string | null>(null);
  const ownMemory = useRef(new Map<string, UnresolvedTip>());
  const attempts = memory ?? ownMemory;
  // إخفاء زر البقشيش يخص الزيارة اللي رجّعت 403 بس، فالتبديل لزيارة تانية يفضل مظهر الزر (#406).
  if (hiddenForSession === sessionId) return null;
  const open = openForSession === sessionId;
  const refuse = (message: string) => {
    setHiddenForSession(sessionId);
    setOpenForSession(null);
    onForbidden?.(message);
  };
  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => {
          if (!disabled) setOpenForSession(sessionId);
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
          onClose={() => setOpenForSession(null)}
        />
      ) : null}
    </>
  );
}
