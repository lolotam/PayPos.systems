import { t } from '@pospay/i18n';
import { CircleAlert, EmptyState, WifiOff } from '@pospay/ui';

import { ClockByCardScreen } from '@/attendance/ui/clock-by-card-screen';
import { useLocale } from '@/shared/locale/locale-context';

export function CardClockAvailability({
  online,
  signedIn,
  retry,
}: {
  online: boolean;
  signedIn: boolean;
  retry: () => Promise<void>;
}) {
  const locale = useLocale();
  if (!online) {
    return (
      <EmptyState
        role="status"
        tone="warning"
        icon={<WifiOff />}
        title={t(locale, 'pos.cardOffline')}
      />
    );
  }
  if (!signedIn) {
    return (
      <EmptyState
        role="status"
        tone="warning"
        icon={<CircleAlert />}
        title={t(locale, 'pos.cardSignedOut')}
      />
    );
  }
  return <ClockByCardScreen onRejected={retry} />;
}
