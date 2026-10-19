import { cancelServiceLineInput, id as uuid, type CancelServiceLineInput } from '@pospay/contracts';
import type { Locale } from '@pospay/i18n';
import type { FieldErrors, Resolver } from 'react-hook-form';
import { envelopeMessage } from '@/shared/api/api-error';
import { editAccessRevoked } from './service-session-access';

const EDGE = /^[\t\r\n ]+|[\t\r\n ]+$/g;
export type CancelLineFormInput = {
  reason: string;
  expected_revision: number;
  canceller_membership_id: string;
};
type CancelFailure =
  | { kind: 'stale'; message: string; revision: number | null }
  | { kind: 'forbidden' | 'revoked' | 'root'; message: string }
  | { kind: 'field'; field: 'reason'; message: string }
  | { kind: 'membership'; message: string; ids: string[] };

export function cancelReason(value: string): string {
  return value.replace(EDGE, '');
}
export function cancelReasonLength(value: string): number {
  return Array.from(cancelReason(value)).length;
}

export function cancelLineBody(value: CancelLineFormInput): CancelServiceLineInput | null {
  const reason = cancelReason(value.reason);
  const length = Array.from(reason).length;
  if (length < 1 || length > 500) return null;
  const parsed = cancelServiceLineInput.safeParse({
    reason,
    expected_revision: value.expected_revision,
    ...(value.canceller_membership_id
      ? { canceller_membership_id: value.canceller_membership_id }
      : {}),
  });
  return parsed.success ? parsed.data : null;
}

export const resolveCancelLine: Resolver<CancelLineFormInput, unknown, CancelServiceLineInput> = (
  value,
) => {
  const errors: FieldErrors<CancelLineFormInput> = {};
  if (cancelReasonLength(value.reason) < 1 || cancelReasonLength(value.reason) > 500)
    errors.reason = { type: 'custom', message: 'reason' };
  const body = cancelLineBody(value);
  if (!body)
    return {
      values: {},
      errors: errors.reason ? errors : { reason: { type: 'custom', message: 'reason' } },
    };
  return { values: body, errors: {} };
};

function refusal(error: unknown) {
  if (!error || typeof error !== 'object') return {};
  const body = error as { status?: unknown; code?: unknown; details?: unknown };
  return {
    status: typeof body.status === 'number' ? body.status : undefined,
    code: typeof body.code === 'string' ? body.code : undefined,
    details: body.details,
  };
}

function readRevision(details: unknown): number | null {
  if (!details || typeof details !== 'object') return null;
  const current = (details as { current_revision?: unknown }).current_revision;
  return typeof current === 'number' && Number.isInteger(current) && current >= 1 ? current : null;
}

function readMemberships(details: unknown): string[] | null {
  if (!details || typeof details !== 'object') return null;
  const ids = (details as { canceller_membership_ids?: unknown }).canceller_membership_ids;
  if (!Array.isArray(ids) || ids.length === 0) return null;
  const parsed: string[] = [];
  for (const item of ids) {
    const result = uuid.safeParse(item);
    if (!result.success) return null;
    parsed.push(result.data);
  }
  return parsed;
}

export function classifyCancelError(error: unknown, locale: Locale): CancelFailure {
  const { status, code, details } = refusal(error);
  const message = envelopeMessage(error, locale);
  if (editAccessRevoked(error)) return { kind: 'revoked', message };
  if (status === 403) return { kind: 'forbidden', message };
  if (status === 409 && code === 'SESSION_LINE_REVISION_STALE')
    return { kind: 'stale', message, revision: readRevision(details) };
  if (status === 422 && code === 'SESSION_CANCEL_REASON_INVALID')
    return { kind: 'field', field: 'reason', message };
  if (status === 422 && code === 'SESSION_CANCELLER_MEMBERSHIP_REQUIRED') {
    const ids = readMemberships(details);
    if (ids) return { kind: 'membership', message, ids };
  }
  return { kind: 'root', message };
}

export function cancelOutcomeKnown(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if (editAccessRevoked(error)) return true;
  const status = (error as { status?: unknown }).status;
  const code = (error as { code?: unknown }).code;
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 400 || status > 499)
    return false;
  if (status === 409) return code === 'SESSION_LINE_REVISION_STALE';
  return true;
}
