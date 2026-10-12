import { t } from '@pospay/i18n';
import { expect, it } from 'vitest';
import { attendanceActionError } from './attendance-action-display';

const envelope = { message_ar: 'Synthetic AR refusal', message_en: 'Synthetic EN refusal' };

it.each(['ar', 'en'] as const)('preserves attendance domain messages in %s', (locale) => {
  for (const code of [
    'ATTENDANCE_CORRECTION_SELF_FORBIDDEN',
    'ATTENDANCE_EXCEPTION_SELF_FORBIDDEN',
    'ATTENDANCE_CHANGE_SELF_FORBIDDEN',
    'ATTENDANCE_SESSION_REVISION_CONFLICT',
    'ATTENDANCE_FUTURE_DOMAIN_REFUSAL',
  ]) {
    for (const status of [403, 404, 409, 422]) {
      expect(attendanceActionError({ ...envelope, code, status }, locale, true)).toBe(
        envelope[locale === 'ar' ? 'message_ar' : 'message_en'],
      );
    }
  }
});

it.each(['ar', 'en'] as const)(
  'uses generic text only for bare access refusals in %s',
  (locale) => {
    for (const code of ['FORBIDDEN', 'NOT_FOUND', undefined]) {
      for (const status of [403, 404]) {
        expect(attendanceActionError({ ...envelope, code, status }, locale, true)).toBe(
          t(locale, 'attendanceActions.permissionDenied'),
        );
      }
    }
    expect(
      attendanceActionError({ ...envelope, code: 'FEATURE_DISABLED', status: 403 }, locale, true),
    ).toBe(t(locale, 'attendanceActions.featureDisabled'));
    expect(
      attendanceActionError(
        { ...envelope, code: 'OTHER_DOMAIN_REFUSAL', status: 403 },
        locale,
        true,
      ),
    ).toBe(envelope[locale === 'ar' ? 'message_ar' : 'message_en']);
  },
);
