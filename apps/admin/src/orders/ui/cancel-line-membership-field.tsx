'use client';
import type { Locale } from '@pospay/i18n';
import type { UseFormRegister } from 'react-hook-form';
import type { CancelLineFormInput } from '../model/cancel-service-line-values';
import { CancelLineMembershipSelect } from './cancel-line-membership-select';

export function CancelLineMembershipField({
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
  if (memberships.length === 0) return null;
  return (
    <CancelLineMembershipSelect
      locale={locale}
      memberships={memberships}
      frozen={frozen}
      register={register}
      companyId={companyId}
      userId={userId}
    />
  );
}
