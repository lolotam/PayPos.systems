import { t } from '@pospay/i18n';
import { Badge } from '@pospay/ui';

/** شارة عدد غير المقروء؛ استُخرجت لإبقاء الجرس تحت سقف طول الدالة. */
export function UnreadBadge({
  unread,
  locale,
}: {
  unread: number;
  locale: 'ar' | 'en' | undefined;
}) {
  if (unread <= 0) return null;
  return (
    <Badge
      variant="brand"
      className="tabular-nums"
      aria-live="polite"
      aria-label={`${t(locale ?? 'en', 'inApp.unread')}: ${unread}`}
    >
      {unread}
    </Badge>
  );
}
