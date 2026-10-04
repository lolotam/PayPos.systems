import { PersonalScreen } from '@/personal-staff/ui/personal-screen';
import { DeviceScreen } from './device-screen';
import { Providers } from './providers';

export function App() {
  return (
    <Providers>
      {window.location.pathname === '/personal' ? <PersonalScreen /> : <DeviceScreen />}
    </Providers>
  );
}
