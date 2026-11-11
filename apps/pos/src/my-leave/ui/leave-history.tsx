import type { LeavePage } from '@pospay/contracts';
import { formatDate, t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

export function LeaveHistory({
  items,
  busy,
  cancel,
}: {
  items: LeavePage['items'];
  busy: boolean;
  cancel(id: string, revision: number): Promise<void>;
}) {
  const locale = useLocale();
  // التواريخ أيام مدنية محفوظة؛ UTC حامل للتنسيق فقط حتى لا يعيد المتصفح تفسيرها.
  const date = (value: string) =>
    formatDate(new Date(`${value}T12:00:00Z`), { locale, calendar: 'gregorian', timeZone: 'UTC' });
  return (
    <ul className="grid gap-4">
      {items.map((item) => (
        <li key={item.id} className="rounded-xl border p-4">
          <p>
            {t(locale, `leave.${item.type}`)} — {t(locale, `leave.${item.status}`)}
          </p>
          <p>
            {date(item.from)} — {date(item.to)}
          </p>
          {item.kind === 'PARTIAL' ? (
            <p>
              {item.start} — {item.end}
            </p>
          ) : null}
          <p>{item.timezone}</p>
          {item.note ? <p>{item.note}</p> : null}
          {item.decision_reason || item.rejection_reason ? (
            <p>
              {t(locale, 'leave.decisionReason')}: {item.decision_reason ?? item.rejection_reason}
            </p>
          ) : null}
          {item.revocation_reason ? (
            <p>
              {t(locale, 'leave.revocationReason')}: {item.revocation_reason}
            </p>
          ) : null}
          {item.can_cancel ? (
            <Button
              disabled={busy}
              variant="outline"
              onClick={() => {
                void cancel(item.id, item.revision);
              }}
            >
              {t(locale, 'leave.cancel')}
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
