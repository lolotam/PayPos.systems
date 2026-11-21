import type { InAppNotification } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Badge, Button } from '@pospay/ui';
import { documentIdOf, renderNotification } from '../model/render-notification';

export function NotificationItem({
  item,
  locale,
  documentNumbers,
  pending,
  onRead,
}: {
  item: InAppNotification;
  locale: Locale;
  documentNumbers: ReadonlyMap<string, string>;
  pending: boolean;
  onRead: (id: string) => void;
}) {
  const textLocale = item.template_key === 'generic_notice' ? item.locale : locale;
  const documentId = documentIdOf(item);
  const documentNumber =
    item.template_key === 'document_expiring' && documentId !== null
      ? // مفتاح الخريطة مخزَّن بحروف صغيرة؛ نطبّع المعرف عند القراءة كمان.
        documentNumbers.get(documentId.toLowerCase())
      : undefined;
  return (
    <li className="flex flex-col gap-2 border-b border-border py-4 text-start last:border-b-0">
      <p lang={textLocale} dir={textLocale === 'ar' ? 'rtl' : 'ltr'}>
        {renderNotification(item, locale, documentNumber)}
      </p>
      <div className="flex items-center gap-2">
        <Badge variant={item.read_at === null ? 'brand' : 'neutral'}>
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
