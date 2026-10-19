'use client';
import type { SessionTips } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { ModalDialog } from '@/shared/ui/modal-dialog';
import type { UnresolvedTip } from '../api/use-record-session-tips';
import { readSessionTips } from '../api/use-session-tips';
import type { SessionServiceScope } from '../api/use-session-services';
import { editAccessRevoked, tipPermissionRefused } from '../model/service-session-access';
import { tipRefusalMessage } from '../model/session-tip-outcome';
import type { TipSourceLine } from '../model/session-tip-source';
import { SessionTipsForm } from './session-tips-form';
import { useFreshSessionTips } from './use-fresh-session-tips';

type CloseRefs = {
  denied: { current: (message: string) => void };
  forbidden: { current: (message: string) => void };
  close: { current: () => void };
};

async function reloadSessionTips(
  scope: SessionServiceScope,
  sessionId: string,
  locale: Locale,
  refs: CloseRefs,
): Promise<SessionTips | null> {
  try {
    return await readSessionTips(scope, sessionId);
  } catch (error) {
    const message = tipRefusalMessage(error, locale);
    if (editAccessRevoked(error)) {
      refs.denied.current(message);
      refs.close.current();
    } else if (tipPermissionRefused(error)) {
      refs.forbidden.current(message);
      refs.close.current();
    }
    return null;
  }
}

function useTipDialogAccess(props: {
  scope: SessionServiceScope;
  sessionId: string;
  error: unknown;
  onAccessDenied: (message: string) => void;
  onForbidden: (message: string) => void;
  onClose: () => void;
}) {
  const locale = useLocale();
  const deniedRef = useRef(props.onAccessDenied);
  const forbiddenRef = useRef(props.onForbidden);
  const closeRef = useRef(props.onClose);
  useEffect(() => {
    deniedRef.current = props.onAccessDenied;
    forbiddenRef.current = props.onForbidden;
    closeRef.current = props.onClose;
  }, [props.onAccessDenied, props.onForbidden, props.onClose]);
  const revoked = editAccessRevoked(props.error);
  const forbidden = tipPermissionRefused(props.error);
  useEffect(() => {
    if (!revoked && !forbidden) return;
    const tell = revoked ? deniedRef.current : forbiddenRef.current;
    tell(tipRefusalMessage(props.error, locale));
    closeRef.current();
  }, [revoked, forbidden, props.error, locale]);
  const reload = () =>
    reloadSessionTips(props.scope, props.sessionId, locale, {
      denied: deniedRef,
      forbidden: forbiddenRef,
      close: closeRef,
    });
  return { locale, revoked, forbidden, reload };
}

export function SessionTipsDialog(props: {
  scope: SessionServiceScope;
  sessionId: string;
  lines: readonly TipSourceLine[];
  online: boolean;
  memory: RefObject<Map<string, UnresolvedTip>>;
  netsKnown?: boolean;
  onAccessDenied: (message: string) => void;
  onForbidden: (message: string) => void;
  onClose: () => void;
}) {
  const { query, loaded } = useFreshSessionTips(props.scope, props.sessionId);
  const access = useTipDialogAccess({ ...props, error: query.error });
  const [busy, setBusy] = useState(false);
  const onBusy = useCallback((value: boolean) => setBusy(value), []);
  const { locale, revoked, forbidden, reload } = access;
  return (
    <ModalDialog title={t(locale, 'sessionTips.title')} pending={busy} onClose={props.onClose}>
      {!loaded && !query.isError ? <p>{t(locale, 'admin.loading')}</p> : null}
      {query.isError && !revoked && !forbidden ? (
        <p role="alert">
          {tipRefusalMessage(query.error, locale)}{' '}
          <Button type="button" variant="outline" onClick={() => void query.refetch()}>
            {t(locale, 'sessionTips.retry')}
          </Button>
        </p>
      ) : null}
      {loaded ? (
        <SessionTipsForm
          scope={props.scope}
          sessionId={props.sessionId}
          lines={props.lines}
          online={props.online}
          loaded={loaded}
          memory={props.memory}
          reload={reload}
          netsKnown={props.netsKnown ?? true}
          onBusy={onBusy}
          onAccessDenied={props.onAccessDenied}
          onForbidden={props.onForbidden}
          onClose={props.onClose}
        />
      ) : null}
    </ModalDialog>
  );
}
