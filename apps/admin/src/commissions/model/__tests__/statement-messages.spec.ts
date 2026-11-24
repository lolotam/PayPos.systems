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

it('words a disabled feature as approval-not-enabled only on the approve step', () => {
  const error = { code: 'FEATURE_DISABLED', message_en: 'x', message_ar: 'x' };
  expect(statementFailure(error, 'en', 'approve').text).toBe(S('errApprovalNotEnabled'));
  expect(statementFailure(error, 'en').text).toBe(S('errFeatureDisabled'));
});

it('marks only a stale fingerprint as needing a reload', () => {
  expect(statementFailure({ code: 'COMMISSION_FINGERPRINT_STALE' }, 'en').stale).toBe(true);
  expect(statementFailure({ code: 'COMMISSION_UPDATES_PENDING' }, 'en').stale).toBe(false);
});

it('uses the server message for an unknown code and the generic one when there is no answer at all', () => {
  const unknown = { code: 'SOMETHING_NEW', message_en: 'Server says no', message_ar: 'السيرفر رفض' };
  expect(statementFailure(unknown, 'en').text).toBe('Server says no');
  expect(statementFailure(unknown, 'ar').text).toBe('السيرفر رفض');
  expect(statementFailure(new TypeError('offline'), 'en').text).toBe(S('errGeneric'));
});
