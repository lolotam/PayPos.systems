'use client';
import { t, type Locale } from '@pospay/i18n';
import { envelopeMessage } from '@/shared/api/api-error';

type FeedbackProps = {
  prefix: string;
  locale: Locale;
  contactInvalid: boolean;
  profileInvalid: boolean;
  genderHint: boolean;
  hasValue: boolean;
  mutation: { isError: boolean; error: unknown };
};

export function SessionCustomerFeedback({
  prefix,
  locale,
  contactInvalid,
  profileInvalid,
  genderHint,
  hasValue,
  mutation,
}: FeedbackProps) {
  return (
    <>
      {contactInvalid ? (
        <p id={`${prefix}-error`} role="alert">
          {t(locale, 'serviceSessions.invalidCustomer')}
        </p>
      ) : null}
      {profileInvalid ? (
        <p id={`${prefix}-profile-error`} role="alert">
          {t(locale, 'serviceSessions.invalidProfileFields')}
        </p>
      ) : null}
      {genderHint && !hasValue ? (
        <p role="status">{t(locale, 'serviceSessions.genderNeededHint')}</p>
      ) : null}
      {mutation.isError ? <p role="alert">{envelopeMessage(mutation.error, locale)}</p> : null}
    </>
  );
}
