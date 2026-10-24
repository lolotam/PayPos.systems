import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';

/** دعوة أول مرة تشغّل الإشعارات على الموبايل ده، مرة واحدة بس (WP-Q1). */
export function PushInvitation({
  disabled,
  onEnable,
  onDismiss,
}: {
  disabled: boolean;
  onEnable(): void;
  onDismiss(): void;
}) {
  const locale = useLocale();
  return (
    <div className="grid gap-2 rounded-interactive border border-input p-3">
      <p>{t(locale, 'staffPush.invitationLead')}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={disabled} onClick={onEnable}>
          {t(locale, 'staffPush.invitationEnable')}
        </Button>
        <Button size="sm" variant="outline" disabled={disabled} onClick={onDismiss}>
          {t(locale, 'staffPush.invitationDismiss')}
        </Button>
      </div>
    </div>
  );
}
