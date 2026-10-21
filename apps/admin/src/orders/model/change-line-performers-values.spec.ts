import { t } from '@pospay/i18n';
import { expect, it } from 'vitest';
import { classifyPerformersError, performersOutcomeKnown } from './change-line-performers-values';
import { id } from './session-recording-result.fixture';

const envelope = (status: number, code: string, details?: unknown) => ({
  status,
  code,
  message_ar: `${code} AR`,
  message_en: `${code} EN`,
  details,
});

it.each([
  [envelope(400, 'VALIDATION_FAILED'), true],
  [envelope(403, 'FORBIDDEN'), true],
  [envelope(422, 'SESSION_PERFORMERS_NO_CHANGE'), true],
  [envelope(409, 'SESSION_LINE_REVISION_STALE'), true],
  [envelope(409, 'IDEMPOTENCY_KEY_IN_PROGRESS'), false],
  [envelope(500, 'INTERNAL'), false],
  [envelope(503, 'BOUNDED_DATABASE_UNAVAILABLE'), false],
  [{ status: 401 }, true],
  [{ status: 200, code: 'FEATURE_DISABLED' }, true],
  [{ status: 422 }, true],
  [new TypeError('network down'), false],
  [null, false],
  [{ status: 422.5 }, false],
])('treats %j as a known outcome: %s', (error, known) => {
  expect(performersOutcomeKnown(error)).toBe(known);
});

it('classifies each refusal into the reaction the dialog shows', () => {
  const kind = (error: unknown) => classifyPerformersError(error, 'en');
  expect(kind(envelope(401, 'UNAUTHENTICATED')).kind).toBe('revoked');
  expect(kind(envelope(403, 'FEATURE_DISABLED')).kind).toBe('revoked');
  expect(kind(envelope(403, 'SESSION_PERFORMER_SELF_FORBIDDEN'))).toEqual({
    kind: 'forbidden',
    message: 'SESSION_PERFORMER_SELF_FORBIDDEN EN',
  });
  expect(kind(envelope(409, 'SESSION_LINE_REVISION_STALE', { current_revision: 4 })).kind).toBe(
    'stale',
  );
  expect(kind(envelope(422, 'SESSION_PERFORMERS_REASON_INVALID')).kind).toBe('field');
  expect(
    kind(
      envelope(422, 'SESSION_CHANGER_MEMBERSHIP_REQUIRED', { changer_membership_ids: [id(30)] }),
    ),
  ).toEqual({
    kind: 'membership',
    message: 'SESSION_CHANGER_MEMBERSHIP_REQUIRED EN',
    ids: [id(30)],
  });
  expect(
    kind(envelope(422, 'SESSION_CHANGER_MEMBERSHIP_REQUIRED', { changer_membership_ids: ['x'] }))
      .kind,
  ).toBe('root');
  expect(kind(envelope(422, 'SESSION_CHANGER_MEMBERSHIP_REQUIRED')).kind).toBe('root');
  expect(kind(envelope(422, 'SESSION_PERFORMER_NOT_ELIGIBLE', { employee_ids: [id(6)] }))).toEqual({
    kind: 'root',
    message: 'SESSION_PERFORMER_NOT_ELIGIBLE EN',
  });
  expect(kind({ status: 422 })).toEqual({ kind: 'root', message: t('en', 'admin.unexpected') });
});
