import { t } from '@pospay/i18n';

import { useLocale } from '@/shared/locale/locale-context';

import { DeviceScreen } from './device-screen';
import { EmployeeFlow } from './employee-flow';
import { FLOW_ALERT_KEYS } from './link-rules';
import { LoadingNotice } from './loading-notice';
import { PasteLinkForm } from './paste-link-form';
import { StartScreen } from './start-screen';
import { useBusinessSwitch } from './use-business-switch';
import { useNativeLink } from './use-native-link';

const ALERT_CLASS =
  'mx-auto mt-4 w-full max-w-md bg-destructive/10 px-4 py-3 text-center text-destructive';

export function NativeEntry() {
  const locale = useLocale();
  const { state, busy, onStart, onLink, choose, confirm, cancel } = useBusinessSwitch();
  useNativeLink(onStart, onLink);

  if (state.kind === 'loading') return <LoadingNotice />;
  if (state.kind === 'flow') {
    const alertText = state.alert ? t(locale, FLOW_ALERT_KEYS[state.alert]) : null;
    const connect = <PasteLinkForm onConnect={(next) => void onLink(next)} />;
    return (
      <>
        {alertText ? (
          <p role="alert" className={ALERT_CLASS}>
            {alertText}
          </p>
        ) : null}
        {state.role === 'counter' ? (
          <DeviceScreen />
        ) : (
          <EmployeeFlow
            business={state.business}
            pending={state.pending ?? null}
            busy={busy}
            connect={connect}
            onConfirm={confirm}
            onCancel={cancel}
          />
        )}
      </>
    );
  }
  return state.alert === undefined ? (
    <StartScreen onChoose={choose} busy={busy} />
  ) : (
    <StartScreen onChoose={choose} alert={state.alert} busy={busy} />
  );
}
