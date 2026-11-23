'use client';

import { t } from '@pospay/i18n';
import type { InviteMemberInput } from '@pospay/contracts';
import { useFormContext } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';

/** كتلة التأكيد: الإيميل كامل ظاهر جنب علامة إجبارية — بتختفي لحد ما الإيميل يتكتب (D10). */
export function InvitationConfirmFields() {
  const locale = useLocale();
  const form = useFormContext<InviteMemberInput>();
  const email = form.watch('email');
  if (email.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <p className="text-sm">
        {t(locale, 'invitations.confirmLead')}{' '}
        <strong data-testid="confirm-email">{email}</strong>
      </p>
      <label className="flex items-center gap-2">
        <input type="checkbox" {...form.register('email_confirmed')} />
        <span className="text-sm">{t(locale, 'invitations.confirmTick')}</span>
      </label>
    </div>
  );
}
