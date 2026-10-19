'use client';
import { t, type Locale } from '@pospay/i18n';
import { NativeSelect } from '@pospay/ui';
import type { UseFormRegister } from 'react-hook-form';
import type { CancelLineFormInput } from '../model/cancel-service-line-values';

export function CancelLineMembershipField({
  locale,
  memberships,
  frozen,
  register,
}: {
  locale: Locale;
  memberships: string[];
  frozen: boolean;
  register: UseFormRegister<CancelLineFormInput>;
}) {
  if (memberships.length === 0) return null;
  const membership = register('canceller_membership_id');
  return (
    <NativeSelect
      aria-label={t(locale, 'serviceLineCancel.membership')}
      disabled={frozen}
      {...membership}
      onChange={(event) => {
        if (!frozen) membership.onChange(event);
      }}
    >
      <option value="">{t(locale, 'serviceLineCancel.membership')}</option>
      {memberships.map((membershipId, index) => (
        <option key={membershipId} value={membershipId}>
          {t(locale, 'serviceLineCancel.membershipN').replace('{n}', String(index + 1))}
        </option>
      ))}
    </NativeSelect>
  );
}
