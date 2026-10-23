import { useEffect, useState } from 'react';

import { PersonalScreen } from '@/personal-staff/ui/personal-screen';

import { DeviceScreen } from './device-screen';
import { readDeviceRole, saveDeviceRole, type DeviceRole } from './device-role';
import { LoadingNotice } from './loading-notice';
import { StartScreen } from './start-screen';

type NativeState =
  | { kind: 'loading' }
  | { kind: 'start'; alert?: 'saveFailed' | 'needsInternet' }
  | { kind: 'flow'; role: DeviceRole };

export function NativeEntry() {
  const [state, setState] = useState<NativeState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void readDeviceRole().then(
      (stored) => {
        if (cancelled) return;
        setState(stored ? { kind: 'flow', role: stored } : { kind: 'start' });
      },
      () => {
        if (cancelled) return;
        // تخزين غير مقروء زي أول تشغيل: المستخدم بيختار تاني، ولو الحفظ فشل يظهر تنبيه الحفظ.
        setState({ kind: 'start' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const choose = (role: DeviceRole) => {
    // من غير نت مفيش حاجة تتحفظ (حالة «أول تشغيل من غير نت» في spec 065): اختيار متحفظ
    // هيفتح الشاشة اللي مش هتوصل للخادم.
    if (!navigator.onLine) {
      setState({ kind: 'start', alert: 'needsInternet' });
      return;
    }
    void saveDeviceRole(role).then(
      () => setState({ kind: 'flow', role }),
      () => setState({ kind: 'start', alert: 'saveFailed' }),
    );
  };

  if (state.kind === 'loading') return <LoadingNotice />;
  if (state.kind === 'flow') {
    return state.role === 'counter' ? <DeviceScreen /> : <PersonalScreen />;
  }
  const { alert } = state;
  if (alert === undefined) return <StartScreen onChoose={choose} />;
  return <StartScreen onChoose={choose} alert={alert} />;
}
