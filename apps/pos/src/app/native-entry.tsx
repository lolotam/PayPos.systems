import { t } from '@pospay/i18n';

import { PersonalScreen } from '@/personal-staff/ui/personal-screen';
import { useLocale } from '@/shared/locale/locale-context';

import { DeviceScreen } from './device-screen';
import { FLOW_ALERT_KEYS } from './link-rules';
import { LoadingNotice } from './loading-notice';
import { PasteLinkForm } from './paste-link-form';
import { StartScreen } from './start-screen';
import { SwitchBusinessPanel } from './switch-business-panel';
import { useBusinessSwitch } from './use-business-switch';
import { useNativeLink } from './use-native-link';
import { useSessionMismatch } from './use-session-mismatch';

const ALERT_CLASS =
  'mx-auto mt-4 w-full max-w-md bg-destructive/10 px-4 py-3 text-center text-destructive';

export function NativeEntry() {
  const locale = useLocale();
  const { state, busy, onStart, onLink, choose, confirm, cancel } = useBusinessSwitch();
  // الجلسة اللي فاضلة من نشاط تاني بتخلص في الخلفية (B4a): النشاط المتذكر يغلب.
  useSessionMismatch(state.kind === 'flow' && state.role === 'employee' ? state.business : null);
  useNativeLink(onStart, onLink);

  if (state.kind === 'loading') return <LoadingNotice />;
  if (state.kind === 'flow') {
    const alertText = state.alert ? t(locale, FLOW_ALERT_KEYS[state.alert]) : null;
    const connect = <PasteLinkForm onConnect={(next) => void onLink(next)} />;
    const pending = state.pending;
    const panel = pending ? (
      <SwitchBusinessPanel busy={busy} onConfirm={() => confirm(pending)} onCancel={cancel} />
    ) : null;
    const personalScreen = state.business ? (
      <PersonalScreen key={state.business.business_id} workspace={state.business} connect={connect} />
    ) : (
      <PersonalScreen connect={connect} />
    );
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
          <>
            {panel}
            {personalScreen}
          </>
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
