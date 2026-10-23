import { t } from '@pospay/i18n';
import { Button, Store, UserRound } from '@pospay/ui';

import { AppFrame } from '@/shared/frame/app-frame';
import { useLocale } from '@/shared/locale/locale-context';
import { LocaleSwitch } from '@/shared/locale/locale-switch';

import type { DeviceRole } from './device-role';

export function StartScreen({ onChoose }: { onChoose: (role: DeviceRole) => void }) {
  const locale = useLocale();
  return (
    <AppFrame brand={t(locale, 'pos.appName')} actions={<LocaleSwitch />}>
      <section className="mx-auto grid w-full max-w-md gap-6">
        <h1 className="text-2xl font-semibold">{t(locale, 'nativeShell.title')}</h1>
        <p className="text-muted-foreground">{t(locale, 'nativeShell.lead')}</p>
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
        <p className="text-muted-foreground">{t(locale, 'nativeShell.needsInternet')}</p>
      </section>
    </AppFrame>
  );
}
