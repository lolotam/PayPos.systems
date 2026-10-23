import { useCallback, useState } from 'react';

import { t } from '@pospay/i18n';

import { PersonalScreen } from '@/personal-staff/ui/personal-screen';
import { useLocale } from '@/shared/locale/locale-context';

import { DeviceScreen } from './device-screen';
import type { DeviceRole } from './device-role';
import {
  FLOW_ALERT_KEYS,
  resolveChoice,
  resolveLink,
  stateAfterFailure,
  stateForRole,
  type NativeState,
} from './link-rules';
import { LoadingNotice } from './loading-notice';
import type { PersonalWorkspace } from './manager-link';
import { PasteLinkForm } from './paste-link-form';
import { StartScreen } from './start-screen';
import { useNativeLink } from './use-native-link';
import { useStepQueue } from './use-step-queue';

const ALERT_CLASS =
  'mx-auto mt-4 w-full max-w-md bg-destructive/10 px-4 py-3 text-center text-destructive';

export function NativeEntry() {
  const locale = useLocale();
  const [state, setState] = useState<NativeState>({ kind: 'loading' });
  const onError = useCallback(() => {
    setState((current) => stateAfterFailure(current, null, null));
  }, []);
  const { busy, queue } = useStepQueue(onError);

  const onStart = useCallback((role: DeviceRole | null, saved: PersonalWorkspace | null) => {
    setState((current) => (current.kind === 'loading' ? stateForRole(role, saved) : current));
  }, []);

  const onLink = useCallback(async (workspace: PersonalWorkspace | null) => {
    queue(async () => {
      const outcome = await resolveLink(workspace);
      if (outcome.kind === 'state') setState(outcome.state);
      else setState((current) => stateAfterFailure(current, outcome.role, outcome.business));
    });
  }, [queue]);

  const choose = (role: DeviceRole) => queue(async () => setState(await resolveChoice(role)));

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
        ) : state.business ? (
          <PersonalScreen workspace={state.business} connect={connect} />
        ) : (
          <PersonalScreen connect={connect} />
        )}
      </>
    );
  }
  if (state.alert === undefined) {
    return busy ? (
      <StartScreen onChoose={choose} busy />
    ) : (
      <StartScreen onChoose={choose} />
    );
  }
  return busy ? (
    <StartScreen onChoose={choose} alert={state.alert} busy />
  ) : (
    <StartScreen onChoose={choose} alert={state.alert} />
  );
}
