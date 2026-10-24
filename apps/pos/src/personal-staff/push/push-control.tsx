import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';
import { PushInstallHint } from './push-install-hint';
import { PushInvitation } from './push-invitation';
import { usePushControl } from './use-push-control';

/** زر إشعارات الموبايل في شاشة الموظف: حالة واحدة من الخمسة (FR-010). */
export function PushControl({ companyId }: { companyId: string }) {
  const locale = useLocale();
  const state = usePushControl({ companyId });
  if (!state.visible) return null;
  const buttonDisabled = state.pending || state.offline;
  return (
    <section className="grid gap-3">
      {state.invitation ? (
        <PushInvitation
          disabled={buttonDisabled}
          onEnable={() => void state.enable()}
          onDismiss={state.dismissInvitation}
        />
      ) : null}
      {state.state === 'install-first' ? <PushInstallHint /> : null}
      {state.state === 'unsupported' ? (
        <p>
          {t(locale, state.storageBlocked ? 'staffPush.storageBlocked' : 'staffPush.unsupported')}
        </p>
      ) : null}
      {state.state === 'blocked' ? <p>{t(locale, 'staffPush.blocked')}</p> : null}
      {state.state === 'off' ? <p>{t(locale, 'staffPush.off')}</p> : null}
      {state.state === 'on' ? <p>{t(locale, 'staffPush.on')}</p> : null}
      {state.offline ? <p role="status">{t(locale, 'staffPush.offline')}</p> : null}
      {state.reconnecting ? <p role="status">{t(locale, 'staffPush.reconnecting')}</p> : null}
      {state.failed ? <p role="alert">{t(locale, 'staffPush.error')}</p> : null}
      {state.state === 'off' ? (
        <Button size="touch" disabled={buttonDisabled} onClick={() => void state.enable()}>
          {t(locale, 'staffPush.enable')}
        </Button>
      ) : null}
      {state.state === 'on' ? (
        <Button
          size="touch"
          variant="outline"
          disabled={buttonDisabled}
          onClick={() => void state.disable()}
        >
          {t(locale, 'staffPush.disable')}
        </Button>
      ) : null}
    </section>
  );
}
