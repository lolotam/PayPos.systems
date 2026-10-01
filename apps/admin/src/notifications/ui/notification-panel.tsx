import type { InAppNotification } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@pospay/ui';
import { NotificationItem } from './notification-item';

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
}: {
  id: string;
  locale: Locale;
  items: readonly InAppNotification[];
  loading: boolean;
  error: boolean;
  pending: boolean;
  unread: number;
  onRead: (id: string) => void;
  onReadAll: () => void;
}) {
  return (
    <Card
      id={id}
      role="region"
      aria-label={t(locale, 'inApp.title')}
      className="absolute end-0 top-full z-20 mt-2 max-h-[70dvh] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto bg-background shadow-lg"
    >
      <CardHeader>
        <CardTitle>{t(locale, 'inApp.title')}</CardTitle>
        <Button variant="outline" disabled={pending || unread === 0} onClick={onReadAll}>
          {t(locale, 'inApp.markAllRead')}
        </Button>
      </CardHeader>
      <CardContent>
        {error ? <p role="alert">{t(locale, 'inApp.error')}</p> : null}
        {loading ? <p role="status">{t(locale, 'inApp.loading')}</p> : null}
        {!loading && !error && items.length === 0 ? <p>{t(locale, 'inApp.empty')}</p> : null}
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
