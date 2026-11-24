import { expect, it } from 'vitest';
import { t } from '@pospay/i18n';
import { statementFailure } from '../statement-messages';

const S = (key: string) => t('en', `commissionStatementScreen.${key}` as never);

it.each([
  ['COMMISSION_STATEMENT_BLOCKED', 'errBlocked'],
  ['COMMISSION_UPDATES_PENDING', 'errUpdatesPending'],
  ['COMMISSION_COVERAGE_NOT_PROVEN', 'errCoverageNotProven'],
  ['FEATURE_DISABLED', 'errFeatureDisabled'],
  ['COMMISSION_FINGERPRINT_STALE', 'errStale'],
  ['COMMISSION_PERIOD_CLOSED', 'errPeriodClosed'],
  ['COMMISSION_STATEMENT_NOT_REVIEWED', 'errNotReviewed'],
  ['COMMISSION_PERIOD_NOT_DRAFT', 'errNotDraft'],
  ['COMMISSION_PERIOD_NOT_ENDED', 'errNotEnded'],
  ['COMMISSION_RETURN_REASON_INVALID', 'errReturnReason'],
  ['VALIDATION_FAILED', 'errInvalidRequest'],
  ['IDEMPOTENCY_KEY_REUSED', 'errKeyReused'],
  ['COMMISSION_STATEMENT_NOT_APPROVED', 'errNotApproved'],
  ['COMMISSION_STATEMENT_ALREADY_PAID', 'errAlreadyPaid'],
  ['COMMISSION_PAID_ON_INVALID', 'errPaidOnInvalid'],
  ['COMMISSION_PAYABLE_TOO_LARGE', 'errPayableTooLarge'],
  ['FORBIDDEN', 'errForbidden'],
  ['IDEMPOTENCY_KEY_IN_PROGRESS', 'errBusy'],
])('turns %s into its own readable message in both languages', (code, key) => {
  const error = { code, message_en: 'server en', message_ar: 'server ar' };
  expect(statementFailure(error, 'en').text).toBe(S(key));
  expect(statementFailure(error, 'ar').text).toBe(t('ar', `commissionStatementScreen.${key}` as never));
  expect(statementFailure(error, 'en').text).not.toContain(code);
});

it('reads the blocking issues and the incomplete line count out of the details', () => {
  const failure = statementFailure(
    {
      code: 'COMMISSION_STATEMENT_BLOCKED',
      details: { issues: [{ employee_id: 'e-1', code: 'NO_PLAN' }, { bad: true }], line_ids: ['l-1', 'l-2'] },
    },
    'en',
  );
  expect(failure.issues).toEqual([{ employeeId: 'e-1', code: 'NO_PLAN' }]);
  expect(failure.lineCount).toBe(2);
});

it('marks a changed state, and only that, as needing a reload', () => {
  expect(statementFailure({ code: 'COMMISSION_FINGERPRINT_STALE' }, 'en').stale).toBe(true);
  expect(statementFailure({ code: 'COMMISSION_STATEMENT_ALREADY_PAID' }, 'en').stale).toBe(true);
  expect(statementFailure({ code: 'COMMISSION_STATEMENT_NOT_APPROVED' }, 'en').stale).toBe(true);
  expect(statementFailure({ code: 'IDEMPOTENCY_KEY_REUSED' }, 'en').stale).toBe(true);
  expect(statementFailure({ code: 'COMMISSION_PAID_ON_INVALID' }, 'en').stale).toBe(false);
  expect(statementFailure({ code: 'COMMISSION_UPDATES_PENDING' }, 'en').stale).toBe(false);
});

it('uses the server message for an unknown code and the generic one when there is no answer at all', () => {
  const unknown = { code: 'SOMETHING_NEW', message_en: 'Server says no', message_ar: 'السيرفر رفض' };
  expect(statementFailure(unknown, 'en').text).toBe('Server says no');
  expect(statementFailure(unknown, 'ar').text).toBe('السيرفر رفض');
  expect(statementFailure(new TypeError('offline'), 'en').text).toBe(S('errGeneric'));
});
