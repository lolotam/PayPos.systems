'use client';
import type { RecordSessionTipsInput } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { NativeSelect } from '@pospay/ui';
import type { UseFormReturn } from 'react-hook-form';
import { useCallerMemberships } from '../api/use-caller-memberships';
import { membershipChoiceLabel } from '../model/membership-choice-label';
import type { SessionTipFormInput } from '../model/session-tip-body';

export function SessionTipsMembership({
  form,
  locale,
  companyId,
  userId,
  memberships,
  locked,
}: {
  form: UseFormReturn<SessionTipFormInput, unknown, RecordSessionTipsInput>;
  locale: Locale;
  companyId: string;
  userId: string;
  memberships: string[];
  locked: boolean;
}) {
  if (memberships.length === 0) return null;
  return (
    <SessionTipsMembershipSelect
      form={form}
      locale={locale}
      companyId={companyId}
      userId={userId}
      memberships={memberships}
      locked={locked}
    />
  );
}

function SessionTipsMembershipSelect({
  form,
  locale,
  companyId,
  userId,
  memberships,
  locked,
}: {
  form: UseFormReturn<SessionTipFormInput, unknown, RecordSessionTipsInput>;
  locale: Locale;
  companyId: string;
  userId: string;
  memberships: string[];
  locked: boolean;
}) {
  const directory = useCallerMemberships(companyId, userId);
  const byId = new Map(directory.memberships.map((membership) => [membership.id, membership]));
  const field = form.register('recorder_membership_id');
  return (
    <NativeSelect
      aria-label={t(locale, 'sessionTips.membership')}
      disabled={locked}
      {...field}
      onChange={(event) => {
        if (!locked) field.onChange(event);
      }}
    >
      <option value="">{t(locale, 'sessionTips.membership')}</option>
      {memberships.map((membershipId, index) => (
        <option key={membershipId} value={membershipId}>
          {membershipChoiceLabel(locale, byId.get(membershipId), index)}
        </option>
      ))}
    </NativeSelect>
  );
}
