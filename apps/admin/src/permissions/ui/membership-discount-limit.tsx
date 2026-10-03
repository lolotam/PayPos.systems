'use client';

import { t } from '@pospay/i18n';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useDiscountLimit } from '../api/use-discount-limit';
import { DiscountLimitForm } from './discount-limit-form';

export function MembershipDiscountLimit({
  companyId,
  userId,
  membershipId,
  limitBps,
  disabled,
}: {
  companyId: string;
  userId: string;
  membershipId: string;
  limitBps: number | null;
  disabled: boolean;
}) {
  const locale = useLocale();
  const mutation = useDiscountLimit(companyId, userId, membershipId);
  return (
    <section className="flex flex-col gap-2">
      <DiscountLimitForm
        key={`${membershipId}:${limitBps}`}
        limitBps={limitBps}
        disabled={disabled}
        pending={mutation.isPending}
        onSave={(input) => mutation.mutate(input)}
      />
      {mutation.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {envelopeMessage(mutation.error, locale)}
        </p>
      ) : null}
      {mutation.isSuccess ? (
        <p role="status" className="text-sm text-success">
          {t(locale, 'permissions.discountSaved')}
        </p>
      ) : null}
    </section>
  );
}
