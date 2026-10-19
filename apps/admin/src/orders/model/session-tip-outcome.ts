import {
  serviceSessionErrors,
  t,
  type ErrorMessageCode,
  type Locale,
  type ServiceSessionErrorCode,
} from '@pospay/i18n';
import { serviceSessionAccessRevoked } from './service-session-access';

const EXTRA: readonly ErrorMessageCode[] = [
  'FORBIDDEN',
  'FEATURE_DISABLED',
  'TRANSACTION_RETRY_REQUIRED',
  'IDEMPOTENCY_KEY_REUSED',
  'IDEMPOTENCY_KEY_REQUIRED',
  'IDEMPOTENCY_KEY_IN_PROGRESS',
  'UNAUTHENTICATED',
  'BAD_REQUEST',
  'INTERNAL_ERROR',
];

export function tipErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

export function tipRefusalMessage(error: unknown, locale: Locale): string {
  const code = tipErrorCode(error);
  if (code && Object.hasOwn(serviceSessionErrors, code)) {
    const row = serviceSessionErrors[code as ServiceSessionErrorCode];
    return locale === 'ar' ? row.message_ar : row.message_en;
  }
  if (code && EXTRA.includes(code as ErrorMessageCode)) {
    return t(locale, `errors.${code as ErrorMessageCode}`);
  }
  return t(locale, 'admin.unexpected');
}

export function recorderMembershipIds(error: unknown): string[] | null {
  if (tipErrorCode(error) !== 'SESSION_RECORDER_MEMBERSHIP_REQUIRED') return null;
  const details = (error as { details?: unknown }).details;
  if (!details || typeof details !== 'object') return null;
  const ids = (details as { recorder_membership_ids?: unknown }).recorder_membership_ids;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) return null;
  return ids;
}

export function conflictRevision(error: unknown): number | null {
  if (tipErrorCode(error) !== 'TIP_REVISION_CONFLICT') return null;
  const status = (error as { status?: unknown }).status;
  if (status !== 409) return null;
  const details = (error as { details?: unknown }).details;
  if (!details || typeof details !== 'object') return null;
  const current = (details as { current_revision?: unknown }).current_revision;
  if (typeof current !== 'number' || !Number.isInteger(current) || current < 0) return null;
  return current;
}

// 401 و403 وFEATURE_DISABLED رفض نهائي زي قائمة اليوم. 409 من غير current_revision ممكن يكون لسه شغّال.
export function tipOutcomeKnown(error: unknown): boolean {
  if (serviceSessionAccessRevoked(error)) return true;
  if (!error || typeof error !== 'object') return false;
  const status = (error as { status?: unknown }).status;
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 400 || status > 499) {
    return false;
  }
  if (status === 409) return conflictRevision(error) !== null;
  return true;
}
