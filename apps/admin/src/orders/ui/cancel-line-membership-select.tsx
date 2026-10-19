'use client';
import { t, type Locale } from '@pospay/i18n';
import { NativeSelect } from '@pospay/ui';
import type { UseFormRegister } from 'react-hook-form';
import { useCallerMemberships } from '../api/use-caller-memberships';
import type { CancelLineFormInput } from '../model/cancel-service-line-values';
import { membershipChoiceLabel } from '../model/membership-choice-label';

export function CancelLineMembershipSelect({
  locale,
  memberships,
  frozen,
  register,
  companyId,
  userId,
}: {
  locale: Locale;
  memberships: string[];
  frozen: boolean;
  register: UseFormRegister<CancelLineFormInput>;
  companyId: string;
  userId: string;
}) {
  const directory = useCallerMemberships(companyId, userId);
  const byId = new Map(directory.memberships.map((membership) => [membership.id, membership]));
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
          {membershipChoiceLabel(locale, byId.get(membershipId), index)}
        </option>
      ))}
    </NativeSelect>
  );
}
