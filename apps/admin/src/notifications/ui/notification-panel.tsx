import type { InAppNotification } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  CircleAlert,
  Inbox,
  LoaderCircle,
} from '@pospay/ui';
import { NotificationItem } from './notification-item';

type Props = {
  id: string;
  locale: Locale;
  items: readonly InAppNotification[];
  loading: boolean;
  error: boolean;
  pending: boolean;
  unread: number;
  onRead: (id: string) => void;
  onReadAll: () => void;
};

export function NotificationPanel({
  id,
  locale,
  items,
  loading,
  error,
  pending,
  unread,
  onRead,
  onReadAll,
}: Props) {
  return (
    <Card
      id={id}
      role="region"
      aria-label={t(locale, 'inApp.title')}
      className="fixed start-4 end-4 top-20 z-40 max-h-[70dvh] overflow-y-auto shadow-sm md:absolute md:start-auto md:end-0 md:top-full md:mt-2 md:w-72 lg:w-96"
    >
      <CardHeader>
        <CardTitle>{t(locale, 'inApp.title')}</CardTitle>
        <Button variant="outline" disabled={pending || unread === 0} onClick={onReadAll}>
          {t(locale, 'inApp.markAllRead')}
        </Button>
      </CardHeader>
      <CardContent>
        {error ? (
          <EmptyState
            role="alert"
            tone="danger"
            icon={<CircleAlert />}
            title={t(locale, 'inApp.error')}
          />
        ) : null}
        {loading ? (
          <EmptyState role="status" icon={<LoaderCircle />} title={t(locale, 'inApp.loading')} />
        ) : null}
        {!loading && !error && items.length === 0 ? (
          <EmptyState icon={<Inbox />} title={t(locale, 'inApp.empty')} />
        ) : null}
        <ul>
          {items.map((item) => (
            <NotificationItem
              key={item.id}
              item={item}
              locale={locale}
              pending={pending}
              onRead={onRead}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
