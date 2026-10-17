import type { ArgumentsHost } from '@nestjs/common';
import { serviceSessionErrors } from '@pospay/i18n';
import { expect, it } from 'vitest';
import { SessionError, type SessionErrorCode } from '../domain/session-error.ts';
import { SessionErrorsFilter } from '../http/session-errors.filter.ts';

const EDIT_422 = [
  'SESSION_EDIT_NO_CHANGE', 'SESSION_LINE_NOT_EDITABLE', 'SESSION_EDIT_REASON_INVALID',
  'SESSION_EDITOR_MEMBERSHIP_REQUIRED', 'SESSION_EDIT_IDENTITY_UNKNOWN',
] as const satisfies readonly SessionErrorCode[];

it.each(EDIT_422)('edit refusal %s is 422 with both messages', (code) => {
  const sent = capture(new SessionError(code, code === 'SESSION_EDITOR_MEMBERSHIP_REQUIRED' ? { editor_membership_ids: ['m1'] } : undefined));
  expect(sent.status).toBe(422);
  expect(sent.body).toMatchObject({ code, ...serviceSessionErrors[code] });
});

it('SESSION_LINE_REVISION_STALE is 409 and details carry current_revision only', () => {
  const sent = capture(new SessionError('SESSION_LINE_REVISION_STALE', { current_revision: 3 }));
  expect(sent.status).toBe(409);
  expect(sent.body).toMatchObject({ code: 'SESSION_LINE_REVISION_STALE', ...serviceSessionErrors.SESSION_LINE_REVISION_STALE, details: { current_revision: 3 } });
  expect(Object.keys((sent.body as { details: object }).details)).toEqual(['current_revision']);
  expect(JSON.stringify((sent.body as { details: object }).details)).not.toMatch(/\d\.\d{3}/);
});

it('SESSION_PERFORMER_SELF_FORBIDDEN stays 403 and discount refusals keep the caller status', () => {
  expect(capture(new SessionError('SESSION_PERFORMER_SELF_FORBIDDEN')).status).toBe(403);
  expect(capture(new SessionError('SESSION_PERFORMER_SELF_FORBIDDEN'), 400).status).toBe(403);
  expect(capture(new SessionError('SESSION_DISCOUNT_ABOVE_LIMIT', { limit_bps_applied: 2000 })).status).toBe(422);
  expect(capture(new SessionError('SESSION_DISCOUNT_INVALID'), 400).status).toBe(400);
  expect(capture(new SessionError('SESSION_DISCOUNT_ABOVE_LIMIT'), 400).status).toBe(400);
  expect(capture(new SessionError('SESSION_EDIT_REASON_INVALID'), 400).status).toBe(422);
  expect(capture(new SessionError('SESSION_LINE_REVISION_STALE', { current_revision: 1 }), 400).status).toBe(409);
  expect(capture(new SessionError('FORBIDDEN')).status).toBe(403);
  expect(capture(new SessionError('FEATURE_DISABLED')).status).toBe(403);
});

function capture(error: SessionError, invalidStatus?: number) {
  const sent: { status?: number; body?: unknown } = {};
  const reply = {
    hasHeader: () => false,
    header() { return this; },
    status(status: number) { sent.status = status; return this; },
    send(body: unknown) { sent.body = body; },
  };
  const host = { switchToHttp: () => ({ getResponse: () => reply, getRequest: () => ({ log: { error() { return undefined; } } }) }) } as unknown as ArgumentsHost;
  (invalidStatus === undefined ? new SessionErrorsFilter() : new SessionErrorsFilter(invalidStatus)).catch(error, host);
  return sent;
}
