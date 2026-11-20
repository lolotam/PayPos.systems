import type { OwnLeaveWriteResult } from '@pospay/contracts';
import { formatDate, t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

export function LatestLeaveRequest({
  request,
  busy,
  cancel,
}: {
  request: OwnLeaveWriteResult;
  busy: boolean;
  cancel(id: string, revision: number): Promise<void>;
}) {
  const locale = useLocale();
  const title = t(locale, 'myLeave.latestRequest');
  const date = (value: string) =>
    formatDate(new Date(`${value}T12:00:00Z`), {
      locale,
      calendar: 'gregorian',
      timeZone: 'UTC',
    });
  return (
    <section aria-label={title} className="grid gap-2 rounded-xl border p-4">
      <h3>{title}</h3>
      <p>
        {t(locale, `leave.${request.type}`)} — {t(locale, `leave.${request.status}`)}
      </p>
      <p>
        {date(request.from)} — {date(request.to)}
      </p>
      {request.kind === 'PARTIAL' ? (
        <p>
          {request.start} — {request.end}
        </p>
      ) : null}
      {request.note ? <p>{request.note}</p> : null}
      {request.can_cancel === true ? (
        <Button
          disabled={busy}
          variant="outline"
          onClick={() => {
            void cancel(request.id, request.revision);
          }}
        >
          {t(locale, 'leave.cancel')}
        </Button>
      ) : null}
    </section>
  );
}
