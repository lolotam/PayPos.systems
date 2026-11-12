import { extendPackageInput, type ExtendPackageInput } from '@pospay/contracts';
import type { MessageKey } from '@pospay/i18n';
import type { FieldErrors, Resolver } from 'react-hook-form';

const EDGE = /^[\t\r\n ]+|[\t\r\n ]+$/g;
export type ExtendPackageFormValues = ExtendPackageInput;

export function trimPackageReason(value: string): string {
  return value.replace(EDGE, '');
}

export function nextDay(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) + 1))
    .toISOString()
    .slice(0, 10);
}

export function extendPackageBody(values: ExtendPackageFormValues): ExtendPackageInput {
  return {
    new_expires_on: values.new_expires_on,
    expected_expires_on: values.expected_expires_on,
    reason: trimPackageReason(values.reason),
  };
}

function calendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function extendPackageResolver(): Resolver<ExtendPackageFormValues> {
  return (values) => {
    const errors: FieldErrors<ExtendPackageFormValues> = {};
    if (!calendarDate(values.new_expires_on)) {
      errors.new_expires_on = { type: 'custom', message: 'dateRequired' };
    } else if (values.new_expires_on <= values.expected_expires_on) {
      errors.new_expires_on = { type: 'custom', message: 'dateNotLater' };
    }
    const length = Array.from(trimPackageReason(values.reason)).length;
    if (length === 0) {
      errors.reason = { type: 'custom', message: 'reasonRequired' };
    } else if (length > 500) {
      errors.reason = { type: 'custom', message: 'reasonTooLong' };
    }
    if (errors.new_expires_on || errors.reason) return { values: {}, errors };
    const body = extendPackageBody(values);
    if (!extendPackageInput.safeParse(body).success) {
      return { values: {}, errors: { new_expires_on: { type: 'custom', message: 'dateRequired' } } };
    }
    return { values: body, errors: {} };
  };
}

function errorParts(error: unknown): { status?: number; code?: string } {
  if (typeof error !== 'object' || error === null) return {};
  const value = error as { status?: unknown; code?: unknown };
  return {
    ...(typeof value.status === 'number' ? { status: value.status } : {}),
    ...(typeof value.code === 'string' ? { code: value.code } : {}),
  };
}

export function extendPackageStale(error: unknown): boolean {
  const { status, code } = errorParts(error);
  return status === 409 && code === 'PACKAGE_EXPIRY_STALE';
}

export function extendErrorMessageKey(error: unknown): MessageKey {
  const { status, code } = errorParts(error);
  if (code === 'PACKAGE_EXPIRY_STALE') return 'packageExtension.errorStale';
  if (code === 'PACKAGE_EXTENSION_NOT_LATER') return 'packageExtension.errorNotLater';
  if (code === 'PACKAGE_EXTENSION_TOO_LONG') return 'packageExtension.errorTooLong';
  if (code === 'PACKAGE_EXTENSION_REASON_INVALID') return 'packageExtension.errorReasonInvalid';
  if (code === 'VALIDATION_FAILED') return 'packageExtension.errorValidation';
  if (code === 'FEATURE_DISABLED') return 'packageExtension.errorFeatureDisabled';
  if (code === 'FORBIDDEN' || status === 403) return 'packageExtension.errorForbidden';
  if (code === 'PACKAGE_NOT_FOUND' || status === 404) return 'packageExtension.errorNotFound';
  if (status === undefined || status === 408 || status === 429) return 'packageExtension.errorNetwork';
  return 'packageExtension.errorGeneric';
}
