import type { InAppNotification } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Badge, Button } from '@pospay/ui';
import { renderNotification } from '../model/render-notification';

export function NotificationItem({
  item,
  locale,
  pending,
  onRead,
}: {
  item: InAppNotification;
  locale: Locale;
  pending: boolean;
  onRead: (id: string) => void;
}) {
  return (
    <li className="flex flex-col gap-2 border-b border-border py-3 text-start">
      <p lang={item.locale} dir={item.locale === 'ar' ? 'rtl' : 'ltr'}>
        {renderNotification(item)}
      </p>
      <div className="flex items-center gap-2">
        <Badge variant={item.read_at === null ? 'default' : 'secondary'}>
          {t(locale, item.read_at === null ? 'inApp.unread' : 'inApp.read')}
        </Badge>
        {item.read_at === null ? (
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => onRead(item.id)}>
            {t(locale, 'inApp.markRead')}
          </Button>
        ) : null}
      </div>
    </li>
  );
}
