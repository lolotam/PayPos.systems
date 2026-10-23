import { t } from '@pospay/i18n';
import { Button, Store, UserRound } from '@pospay/ui';

import { AppFrame } from '@/shared/frame/app-frame';
import { useLocale } from '@/shared/locale/locale-context';
import { LocaleSwitch } from '@/shared/locale/locale-switch';

import type { DeviceRole } from './device-role';

const ALERT_KEYS = {
  saveFailed: 'nativeShell.saveFailed',
  needsInternet: 'nativeShell.needsInternet',
  linkRequired: 'personalStaff.linkRequired',
} as const;

export function StartScreen({
  onChoose,
  alert,
}: {
  onChoose: (role: DeviceRole) => void;
  alert?: keyof typeof ALERT_KEYS;
}) {
  const locale = useLocale();
  const alertText = alert ? t(locale, ALERT_KEYS[alert]) : null;
  return (
    <AppFrame brand={t(locale, 'pos.appName')} actions={<LocaleSwitch />}>
      <section className="mx-auto grid w-full max-w-md gap-6">
        <h1 className="text-2xl font-semibold">{t(locale, 'nativeShell.title')}</h1>
        <p className="text-muted-foreground">{t(locale, 'nativeShell.lead')}</p>
        {alertText ? (
          <p role="alert" className="bg-destructive/10 px-4 py-3 text-center text-destructive">
            {alertText}
          </p>
        ) : null}
        <div className="grid grid-cols-1 gap-4 landscape:grid-cols-2">
          <div className="grid gap-2">
            <Button
              className="w-full justify-start gap-3"
              size="lg"
              variant="outline"
              onClick={() => onChoose('counter')}
            >
              <Store aria-hidden="true" className="shrink-0" />
              <span>{t(locale, 'nativeShell.counter')}</span>
            </Button>
            <p className="text-muted-foreground">{t(locale, 'nativeShell.counterHint')}</p>
          </div>
          <div className="grid gap-2">
            <Button
              className="w-full justify-start gap-3"
              size="lg"
              variant="outline"
              onClick={() => onChoose('employee')}
            >
              <UserRound aria-hidden="true" className="shrink-0" />
              <span>{t(locale, 'nativeShell.employee')}</span>
            </Button>
            <p className="text-muted-foreground">{t(locale, 'nativeShell.employeeHint')}</p>
          </div>
        </div>
        <p className="text-muted-foreground">{t(locale, 'nativeShell.needsInternet')}</p>
      </section>
    </AppFrame>
  );
}
