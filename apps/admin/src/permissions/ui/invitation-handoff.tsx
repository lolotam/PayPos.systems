'use client';

import { t } from '@pospay/i18n';

import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { InvitationLinkOnce } from './invitation-link-once';

type Props = {
  link: string | null;
  reissued: boolean;
  error: unknown;
  onDismiss: () => void;
};

/** تسليم الرابط للمالك: الرابط مرة واحدة، وتأكيد إعادة الإصدار، ورسالة آخر خطأ. */
export function InvitationHandoff({ link, reissued, error, onDismiss }: Props) {
  const locale = useLocale();
  return (
    <>
      {link !== null ? <InvitationLinkOnce link={link} onDismiss={onDismiss} /> : null}
      {reissued && link !== null ? (
        <p role="status" className="text-sm text-success">
          {t(locale, 'invitations.reissued')}
        </p>
      ) : null}
      {error !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {envelopeMessage(error, locale)}
        </p>
      ) : null}
    </>
  );
}
