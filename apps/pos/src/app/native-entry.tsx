import { useCallback, useRef, useState } from 'react';

import { t } from '@pospay/i18n';

import { PersonalScreen } from '@/personal-staff/ui/personal-screen';
import { useLocale } from '@/shared/locale/locale-context';

import { DeviceScreen } from './device-screen';
import { readDeviceRole, readRememberedBusiness, saveDeviceRole, type DeviceRole } from './device-role';
import { LoadingNotice } from './loading-notice';
import {
  FLOW_ALERT_KEYS,
  stateAfterFailure,
  stateAfterLink,
  stateForRole,
  withLinkRequired,
  type NativeState,
} from './link-rules';
import type { PersonalWorkspace } from './manager-link';
import { PasteLinkForm } from './paste-link-form';
import { StartScreen } from './start-screen';
import { useNativeLink } from './use-native-link';

/**
 * اختيار نوع الجهاز: من غير نت مفيش حاجة تتحفظ، ومع نت بنحفظ الدور ونفتح الشاشة (spec 065).
 *
 * @param role      الدور اللي اختارته الموظفة
 * @param business  النشاط المتذكر على الجهاز
 * @param setState  تحديث حالة الشاشة
 */
function chooseRole(
  role: DeviceRole,
  business: PersonalWorkspace | null,
  setState: (state: NativeState) => void,
): void {
  if (!navigator.onLine) {
    setState({ kind: 'start', business, alert: 'needsInternet' });
    return;
  }
  void saveDeviceRole(role).then(
    () => setState({ kind: 'flow', role, business }),
    () => setState({ kind: 'start', business, alert: 'saveFailed' }),
  );
}

export function NativeEntry() {
  const locale = useLocale();
  const [state, setState] = useState<NativeState>({ kind: 'loading' });
  const business = state.kind === 'loading' ? null : state.business;
  // اللينكات بتتر واحد ورا التاني: كل لينك بيقرا الدور والنشاط تاني من التخزين قبل ما يقرر.
  const links = useRef<Promise<void>>(Promise.resolve());

  const onStart = useCallback((role: DeviceRole | null, saved: PersonalWorkspace | null) => {
    setState((current) => (current.kind === 'loading' ? stateForRole(role, saved) : current));
  }, []);

  const onLink = useCallback(async (workspace: PersonalWorkspace | null) => {
    links.current = links.current
      .then(async () => {
        const [role, saved] = await Promise.all([readDeviceRole(), readRememberedBusiness()]);
        try {
          setState(
            workspace === null
              ? withLinkRequired(role, saved)
              : await stateAfterLink(role, saved, workspace),
          );
        } catch {
          setState((current) => stateAfterFailure(current, role, saved));
        }
      })
      .catch(() => setState((current) => stateAfterFailure(current, null, null)));
  }, []);

  useNativeLink(onStart, onLink);

  const choose = (role: DeviceRole) => chooseRole(role, business, setState);

  if (state.kind === 'loading') return <LoadingNotice />;
  if (state.kind === 'flow') {
    const alertText = state.alert ? t(locale, FLOW_ALERT_KEYS[state.alert]) : null;
    const connect = <PasteLinkForm onConnect={(next) => void onLink(next)} />;
    return (
      <>
        {alertText ? (
          <p
            role="alert"
            className="mx-auto mt-4 w-full max-w-md bg-destructive/10 px-4 py-3 text-center text-destructive"
          >
            {alertText}
          </p>
        ) : null}
        {state.role === 'counter' ? (
          <DeviceScreen />
        ) : business ? (
          <PersonalScreen workspace={business} connect={connect} />
        ) : (
          <PersonalScreen connect={connect} />
        )}
      </>
    );
  }
  if (state.alert === undefined) return <StartScreen onChoose={choose} />;
  return <StartScreen onChoose={choose} alert={state.alert} />;
}
