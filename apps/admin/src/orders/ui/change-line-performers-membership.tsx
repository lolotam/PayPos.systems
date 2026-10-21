'use client';
import { t, type Locale } from '@pospay/i18n';
import { NativeSelect } from '@pospay/ui';
import type { UseFormRegister } from 'react-hook-form';
import { useCallerMemberships } from '../api/use-caller-memberships';
import type { PerformersFormInput } from '../model/change-line-performers-values';
import { membershipChoiceLabel } from '../model/membership-choice-label';

function MembershipSelect({
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
  register: UseFormRegister<PerformersFormInput>;
  companyId: string;
  userId: string;
}) {
  const directory = useCallerMemberships(companyId, userId);
  const byId = new Map(directory.memberships.map((membership) => [membership.id, membership]));
  const field = register('changer_membership_id');
  return (
    <NativeSelect
      aria-label={t(locale, 'serviceLinePerformers.membership')}
      disabled={frozen}
      {...field}
      onChange={(event) => {
        if (!frozen) void field.onChange(event);
      }}
    >
      <option value="">{t(locale, 'serviceLinePerformers.membership')}</option>
      {memberships.map((membershipId, index) => (
        <option key={membershipId} value={membershipId}>
          {membershipChoiceLabel(locale, byId.get(membershipId), index)}
        </option>
      ))}
    </NativeSelect>
  );
}

// الاختيار بيظهر بس بعد رفض SESSION_CHANGER_MEMBERSHIP_REQUIRED، والعضويات من تفاصيل الرفض نفسه مش من القائمة كلها.
export function ChangeLineMembershipField(props: {
  locale: Locale;
  memberships: string[];
  frozen: boolean;
  register: UseFormRegister<PerformersFormInput>;
  companyId: string;
  userId: string;
}) {
  if (props.memberships.length === 0) return null;
  return <MembershipSelect {...props} />;
}
