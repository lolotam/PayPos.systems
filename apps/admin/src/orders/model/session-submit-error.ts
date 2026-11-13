import type { FieldPath, UseFormSetError } from 'react-hook-form';
import { t, type Locale } from '@pospay/i18n';
import { envelopeMessage } from '@/shared/api/api-error';
import type { SessionDraftForm } from './session-drafts';

type SubmitIssue = { path: PropertyKey[] };

function linePath(path: string): FieldPath<SessionDraftForm> {
  return path as FieldPath<SessionDraftForm>;
}

function knownSubmitError(locale: Locale, path: PropertyKey[]): { name: FieldPath<SessionDraftForm>; message: string } | null {
  const [head, index, field, nested, leaf] = path;
  if (head === 'occurred_at') return { name: 'occurred_at', message: t(locale, 'serviceSessions.invalidTime') };
  if (head !== 'lines' || typeof index !== 'number') return null;
  if (field === 'service_id') return { name: linePath(`lines.${index}.service_id`), message: t(locale, 'serviceSessions.chooseService') };
  if (field === 'price') return { name: linePath(`lines.${index}.price`), message: t(locale, 'serviceSessions.invalidPrice') };
  if (field === 'discount' && nested === 'amount') return { name: linePath(`lines.${index}.discount_amount`), message: t(locale, 'serviceSessions.invalidDiscount') };
  if (field === 'discount' && nested === 'bps') return { name: linePath(`lines.${index}.discount_percentage`), message: t(locale, 'serviceSessions.invalidDiscount') };
  if (field === 'performers' && typeof nested === 'number' && leaf === 'employee_id') return { name: linePath(`lines.${index}.performers.${nested}.employee_id`), message: t(locale, 'serviceSessions.choosePerformer') };
  if (field === 'performers' && typeof nested === 'number' && leaf === 'share_bps') return { name: linePath(`lines.${index}.performers.${nested}.share_percentage`), message: t(locale, 'serviceSessions.invalidShare') };
  return null;
}

function contractIssues(error: unknown): SubmitIssue[] | null {
  if (!(error instanceof Error) || !('issues' in error) || !Array.isArray(error.issues)) return null;
  return error.issues.flatMap((issue) => {
    if (!issue || typeof issue !== 'object' || !('path' in issue) || !Array.isArray(issue.path)) return [];
    return [{ path: issue.path }];
  });
}

export function reportSessionSubmitError(setError: UseFormSetError<SessionDraftForm>, error: unknown, locale: Locale) {
  const issues = contractIssues(error);
  const known = issues?.flatMap((issue) => {
    const mapped = knownSubmitError(locale, issue.path);
    return mapped ? [mapped] : [];
  }) ?? [];
  if (known.length) {
    for (const row of known) setError(row.name, { message: row.message });
    return;
  }
  setError('root', { message: envelopeMessage(error, locale) });
}
