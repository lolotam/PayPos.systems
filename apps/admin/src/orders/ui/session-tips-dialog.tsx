'use client';
import type { SessionTips } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useEffect, useRef, type RefObject } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { ModalDialog } from '@/shared/ui/modal-dialog';
import type { UnresolvedTip } from '../api/use-record-session-tips';
import { readSessionTips, useSessionTips } from '../api/use-session-tips';
import type { SessionServiceScope } from '../api/use-session-services';
import { serviceSessionAccessRevoked } from '../model/service-session-access';
import { tipRefusalMessage } from '../model/session-tip-outcome';
import type { TipSourceLine } from '../model/session-tip-source';
import { SessionTipsForm } from './session-tips-form';

type CloseRefs = {
  denied: { current: (message: string) => void };
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
    if (serviceSessionAccessRevoked(error)) {
      refs.denied.current(tipRefusalMessage(error, locale));
      refs.close.current();
    }
    return null;
  }
}

export function SessionTipsDialog(props: {
  scope: SessionServiceScope;
  sessionId: string;
  lines: readonly TipSourceLine[];
  online: boolean;
  memory: RefObject<Map<string, UnresolvedTip>>;
  onAccessDenied: (message: string) => void;
  onClose: () => void;
}) {
  const locale = useLocale();
  const query = useSessionTips(props.scope, props.sessionId, true);
  const deniedRef = useRef(props.onAccessDenied);
  const closeRef = useRef(props.onClose);
  useEffect(() => {
    deniedRef.current = props.onAccessDenied;
    closeRef.current = props.onClose;
  }, [props.onAccessDenied, props.onClose]);
  const denied = serviceSessionAccessRevoked(query.error);
  useEffect(() => {
    if (!denied) return;
    deniedRef.current(tipRefusalMessage(query.error, locale));
    closeRef.current();
  }, [denied, query.error, locale]);
  const reload = () =>
    reloadSessionTips(props.scope, props.sessionId, locale, { denied: deniedRef, close: closeRef });
  return (
    <ModalDialog title={t(locale, 'sessionTips.title')} onClose={props.onClose}>
      {query.isPending ? <p>{t(locale, 'admin.loading')}</p> : null}
      {query.isError && !denied ? (
        <p role="alert">
          {tipRefusalMessage(query.error, locale)}{' '}
          <Button type="button" variant="outline" onClick={() => void query.refetch()}>
            {t(locale, 'sessionTips.retry')}
          </Button>
        </p>
      ) : null}
      {query.data && !query.isError ? (
        <SessionTipsForm
          scope={props.scope}
          sessionId={props.sessionId}
          lines={props.lines}
          online={props.online}
          loaded={query.data}
          memory={props.memory}
          reload={reload}
          onAccessDenied={props.onAccessDenied}
          onClose={props.onClose}
        />
      ) : null}
    </ModalDialog>
  );
}
