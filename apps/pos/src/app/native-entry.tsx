import { useEffect, useState } from 'react';

import { PersonalScreen } from '@/personal-staff/ui/personal-screen';

import { DeviceScreen } from './device-screen';
import { readDeviceRole, saveDeviceRole, type DeviceRole } from './device-role';
import { LoadingNotice } from './loading-notice';
import { StartScreen } from './start-screen';

type NativeState =
  { kind: 'loading' } | { kind: 'start'; failed: boolean } | { kind: 'flow'; role: DeviceRole };

export function NativeEntry() {
  const [state, setState] = useState<NativeState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void readDeviceRole().then(
      (stored) => {
        if (cancelled) return;
        setState(stored ? { kind: 'flow', role: stored } : { kind: 'start', failed: false });
      },
      () => {
        if (cancelled) return;
        setState({ kind: 'start', failed: false });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const choose = (role: DeviceRole) => {
    void saveDeviceRole(role).then(
      () => setState({ kind: 'flow', role }),
      () => setState({ kind: 'start', failed: true }),
    );
  };

  if (state.kind === 'loading') return <LoadingNotice />;
  if (state.kind === 'flow') {
    return state.role === 'counter' ? <DeviceScreen /> : <PersonalScreen />;
  }
  return <StartScreen onChoose={choose} saveFailed={state.failed} />;
}
