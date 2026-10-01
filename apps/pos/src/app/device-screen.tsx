import { t } from '@pospay/i18n';

import { useDeviceSession } from '@/device/api/use-device-session';
import { AppFrame } from '@/shared/frame/app-frame';
import { useLocale } from '@/shared/locale/locale-context';
import { LocaleSwitch } from '@/shared/locale/locale-switch';

import { DeviceBody } from './device-body';

export function DeviceScreen() {
  const locale = useLocale();
  const session = useDeviceSession();
  return (
    <AppFrame brand={t(locale, 'pos.appName')} actions={<LocaleSwitch />}>
      <DeviceBody session={session} />
    </AppFrame>
  );
}
