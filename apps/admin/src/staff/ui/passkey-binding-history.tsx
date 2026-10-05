'use client';
import type { EmployeePasskeyHistory } from '@pospay/contracts';
import { formatInstant, t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';

export function PasskeyBindingHistory({
  data,
  timeZone,
}: {
  data: EmployeePasskeyHistory;
  timeZone: string;
}) {
  const locale = useLocale();
  const date = (value: string) => formatInstant(new Date(value), locale, timeZone);
  return (
    <>
      <p>
        {data.status.bound_at
          ? `${t(locale, 'passkeyAdmin.bound')} ${date(data.status.bound_at)}`
          : t(locale, 'passkeyAdmin.notBound')}
      </p>
      <h4>{t(locale, 'passkeyAdmin.history')}</h4>
      <ul className="flex flex-col gap-2">
        {data.items.map((item) => (
          <li key={item.binding_id}>
            {t(locale, 'passkeyAdmin.bound')} {date(item.bound_at)}
            {item.unbound_at ? (
              <>
                {' '}
                · {t(locale, 'passkeyAdmin.unbound')} {date(item.unbound_at)}
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}
