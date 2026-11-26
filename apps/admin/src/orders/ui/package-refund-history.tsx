'use client';
import type { CustomerPackageRefund } from '@pospay/contracts';
import { formatInstant, t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import { packageMoney } from '../model/customer-package-view';

function methodLabel(locale: 'ar' | 'en', method: string): string {
  return method === 'CARD'
    ? t(locale, 'packageRefund.methodCard')
    : t(locale, 'packageRefund.methodCash');
}

function HistoryAmountRow({ sessions, amount }: { sessions: number; amount: string }) {
  const locale = useLocale();
  const [beforeSessions, afterSessions = ''] = t(locale, 'packageRefund.historyRow').split(
    '{sessions}',
  );
  const [between, afterAmount = ''] = afterSessions.split('{amount}');
  return (
    <span>
      {beforeSessions}
      <bdi dir="ltr">{sessions}</bdi>
      {between}
      <bdi dir="ltr">{packageMoney(amount)}</bdi>
      {afterAmount}
    </span>
  );
}

export function PackageRefundHistory({
  refunds,
  timeZone,
}: {
  refunds: readonly CustomerPackageRefund[];
  timeZone: string | undefined;
}) {
  const locale = useLocale();
  return (
    <section className="grid gap-2 text-start" aria-label={t(locale, 'packageRefund.historyTitle')}>
      <h3 className="font-semibold">{t(locale, 'packageRefund.historyTitle')}</h3>
      {refunds.length === 0 ? (
        <p role="status">{t(locale, 'packageRefund.historyEmpty')}</p>
      ) : (
        <ol className="grid gap-2 ps-4">
          {refunds.map((refund) => (
            <li key={refund.id} className="grid gap-1">
              <HistoryAmountRow sessions={refund.sessions} amount={refund.amount} />
              <span>
                {t(locale, 'packageRefund.historyRowMethod').replace('{method}', '')}
                {methodLabel(locale, refund.method)}
              </span>
              {timeZone ? (
                <span>
                  {t(locale, 'packageRefund.historyRowTime').replace('{at}', '')}
                  <bdi dir="ltr">
                    {formatInstant(new Date(refund.refunded_at), locale, timeZone)}
                  </bdi>
                </span>
              ) : null}
              {refund.reason.length > 0 ? (
                <span>
                  {t(locale, 'packageRefund.historyRowReason').replace('{reason}', '')}
                  <bdi dir="auto">{refund.reason}</bdi>
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
