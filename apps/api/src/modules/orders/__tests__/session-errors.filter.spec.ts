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

const TIP_422 = [
  'TIP_WINDOW_CLOSED', 'TIP_SELF_FORBIDDEN', 'TIP_IDENTITY_UNKNOWN', 'TIP_EMPLOYEE_NOT_PERFORMER',
  'TIP_TOTAL_TOO_LARGE', 'TIP_REASON_REQUIRED', 'TIP_NO_CHANGE',
] as const satisfies readonly SessionErrorCode[];

it.each(TIP_422)('tip refusal %s is 422 with both messages', (code) => {
  const sent = capture(new SessionError(code), code === 'TIP_SELF_FORBIDDEN' ? 403 : 400);
  expect(sent.status).toBe(422);
  expect(sent.body).toMatchObject({ code, ...serviceSessionErrors[code] });
  expect(sent.body).not.toHaveProperty('details');
});

it('SESSION_NOT_FOUND is 404 and TIP_REVISION_CONFLICT is 409 with current_revision only', () => {
  const missing = capture(new SessionError('SESSION_NOT_FOUND'), 400);
  expect(missing.status).toBe(404);
  expect(missing.body).toEqual({ code: 'SESSION_NOT_FOUND', ...serviceSessionErrors.SESSION_NOT_FOUND });
  const conflict = capture(new SessionError('TIP_REVISION_CONFLICT', { current_revision: 2 }));
  expect(conflict.status).toBe(409);
  expect(conflict.body).toMatchObject({ code: 'TIP_REVISION_CONFLICT', ...serviceSessionErrors.TIP_REVISION_CONFLICT, details: { current_revision: 2 } });
  expect(Object.keys((conflict.body as { details: object }).details)).toEqual(['current_revision']);
  expect(JSON.stringify((conflict.body as { details: object }).details)).not.toMatch(/\d\.\d{3}/);
});

const CANCEL_422 = [
  'SESSION_LINE_ALREADY_CANCELLED', 'SESSION_CANCEL_REASON_INVALID', 'SESSION_CANCEL_BLOCKED_BY_TIP',
  'SESSION_LINE_IDENTITY_UNKNOWN', 'SESSION_CANCELLER_MEMBERSHIP_REQUIRED', 'SESSION_LINE_NOT_CANCELLABLE',
] as const satisfies readonly SessionErrorCode[];

it.each(CANCEL_422)('cancel refusal %s is 422 with both messages even when the filter default is 400', (code) => {
  const details = code === 'SESSION_CANCEL_BLOCKED_BY_TIP' ? { employee_ids: ['e1'] }
    : code === 'SESSION_CANCELLER_MEMBERSHIP_REQUIRED' ? { canceller_membership_ids: ['m1'] } : undefined;
  const sent = capture(new SessionError(code, details), 400);
  expect(sent.status).toBe(422);
  expect(sent.body).toMatchObject({ code, ...serviceSessionErrors[code] });
  if (details === undefined) expect(sent.body).not.toHaveProperty('details');
  else {
    expect((sent.body as { details: object }).details).toEqual(details);
    expect(Object.keys(details)).toEqual(Object.keys((sent.body as { details: object }).details));
    expect(JSON.stringify((sent.body as { details: object }).details)).not.toMatch(/\d\.\d{3}/);
  }
});

const PERFORMERS_422 = [
  'SESSION_PERFORMERS_NO_CHANGE', 'SESSION_PERFORMERS_REASON_INVALID',
  'SESSION_CHANGER_MEMBERSHIP_REQUIRED', 'SESSION_LINE_PERFORMERS_NOT_CHANGEABLE',
] as const satisfies readonly SessionErrorCode[];

it.each(PERFORMERS_422)('performer change refusal %s is 422 with both messages even when the filter default is 400', (code) => {
  const details = code === 'SESSION_CHANGER_MEMBERSHIP_REQUIRED' ? { changer_membership_ids: ['m1'] } : undefined;
  const sent = capture(new SessionError(code, details), 400);
  expect(sent.status).toBe(422);
  expect(sent.body).toMatchObject({ code, ...serviceSessionErrors[code] });
  if (details === undefined) expect(sent.body).not.toHaveProperty('details');
  else expect((sent.body as { details: object }).details).toEqual(details);
});

it('SESSION_TIME_TOO_OLD follows the caller status and is 422 by default', () => {
  expect(capture(new SessionError('SESSION_TIME_TOO_OLD')).status).toBe(422);
  expect(capture(new SessionError('SESSION_TIME_TOO_OLD'), 400).status).toBe(400);
  expect(capture(new SessionError('SESSION_TIME_TOO_OLD')).body).toEqual({
    code: 'SESSION_TIME_TOO_OLD', ...serviceSessionErrors.SESSION_TIME_TOO_OLD,
  });
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
