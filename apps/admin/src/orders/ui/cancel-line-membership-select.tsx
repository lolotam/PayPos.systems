'use client';
import { t, type Locale } from '@pospay/i18n';
import { NativeSelect } from '@pospay/ui';
import type { UseFormRegister } from 'react-hook-form';
import { workspaceScopeNames } from '@/workspace/model/scope-names';
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
  const directory = useCallerMemberships(companyId, userId, memberships);
  const company = directory.companies.find((item) => item.id === companyId);
  const names = company ? workspaceScopeNames(company, locale) : {};
  const byId = new Map(directory.memberships.map((item) => [item.id, item]));
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
          {membershipChoiceLabel(locale, byId.get(membershipId), names, index)}
        </option>
      ))}
    </NativeSelect>
  );
}
