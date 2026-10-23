import { PersonalScreen } from '@/personal-staff/ui/personal-screen';
import { isNativeShell } from '@/shared/platform/native-shell';

import { DeviceScreen } from './device-screen';
import { NativeEntry } from './native-entry';
import { Providers } from './providers';

export function App() {
  const native = isNativeShell();
  const personal = window.location.pathname === '/personal';
  return (
    <Providers>
      {native ? <NativeEntry /> : personal ? <PersonalScreen /> : <DeviceScreen />}
    </Providers>
  );
}
