'use client';
import { formatInstant, t, type Locale } from '@pospay/i18n';
import { useState } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useEmployeePasskeys } from '../api/use-passkeys';
import { EmployeePageNavigation } from './employee-page-navigation';
import { UnbindPasskeyForm } from './unbind-passkey-form';
import { PasskeyBindingHistory } from './passkey-binding-history';
interface PasskeySectionProps {
  companyId: string;
  businessId: string;
  userId: string;
  employeeId: string;
  timeZone: string;
}
export function EmployeePasskeySection({
  companyId,
  businessId,
  userId,
  employeeId,
  timeZone,
}: PasskeySectionProps) {
  const locale = useLocale();
  const [cursor, setCursor] = useState<string>();
  const { history, unbind } = useEmployeePasskeys(
    companyId,
    businessId,
    userId,
    employeeId,
    cursor,
  );
  if (!history.isFetchedAfterMount) return null;
  if (history.isError) return <p role="status">{unavailableMessage(history.error, locale)}</p>;
  if (!history.data) return null;
  const status = history.data.status;
  return (
    <section aria-label={t(locale, 'passkeyAdmin.title')} className="flex flex-col gap-4">
      <h3 className="font-bold">{t(locale, 'passkeyAdmin.title')}</h3>
      {status.bound && status.phone_locked ? (
        <p>
          {t(locale, 'phoneLock.locked')}
          {status.phone_locked_since
            ? ` · ${t(locale, 'phoneLock.since')} ${formatInstant(new Date(status.phone_locked_since), locale, timeZone)}`
            : null}
        </p>
      ) : null}
      <PasskeyBindingHistory data={history.data} timeZone={timeZone} />
      <EmployeePageNavigation
        cursor={cursor}
        next={history.data.next_cursor}
        onChange={setCursor}
      />
      {history.data.can_unbind && status.bound && status.binding_id && status.revision ? (
        <UnbindPasskeyForm
          key={`${status.binding_id}:${status.revision}`}
          bindingId={status.binding_id}
          revision={status.revision}
          pending={unbind.isPending}
          onSave={(body) => unbind.mutate(body, { onSuccess: () => setCursor(undefined) })}
        />
      ) : null}
      {unbind.isError ? <p role="alert">{envelopeMessage(unbind.error, locale)}</p> : null}
      {unbind.isSuccess ? <p role="status">{t(locale, 'passkeyAdmin.saved')}</p> : null}
    </section>
  );
}

function unavailableMessage(error: unknown, locale: Locale): string {
  const code = (error as { code?: unknown } | null)?.code;
  return t(
    locale,
    code === 'FEATURE_DISABLED' ? 'passkeyAdmin.disabled' : 'passkeyAdmin.unavailable',
  );
}
