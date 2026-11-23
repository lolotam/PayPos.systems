'use client';

import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';

/** سطور حالة الدعوة: تنبيه حساب موجود بدون رابط، وتأكيد إعادة الإصدار — فوق النموذج. */
export function InvitationNotices({
  existing,
  reissued,
}: {
  existing: boolean;
  reissued: boolean;
}) {
  const locale = useLocale();
  return (
    <>
      {existing ? (
        <p role="status" className="text-sm text-success">
          {t(locale, 'invitations.existingNoLink')}
        </p>
      ) : null}
      {reissued ? (
        <p role="status" className="text-sm text-success">
          {t(locale, 'invitations.reissued')}
        </p>
      ) : null}
    </>
  );
}
