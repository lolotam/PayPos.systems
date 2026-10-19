'use client';
import { parseMoney } from '@pospay/domain';
import { formatKwd, t, type Locale } from '@pospay/i18n';
import { tipExceedsVisit, tipMethodTotals, type TipAmountRow } from '../model/session-tip-body';
import type { TipSourceLine } from '../model/session-tip-source';

export function SessionTipsMethodTotals(props: {
  locale: Locale;
  rows: readonly TipAmountRow[];
  lines: readonly TipSourceLine[];
}) {
  const totals = tipMethodTotals(props.rows);
  return (
    <>
      {totals ? (
        <p>
          {t(props.locale, 'sessionTips.cashTotal')}{' '}
          <bdi>{formatKwd(parseMoney(totals.total_cash))}</bdi>{' '}
          {t(props.locale, 'sessionTips.cardTotal')}{' '}
          <bdi>{formatKwd(parseMoney(totals.total_card))}</bdi>
        </p>
      ) : null}
      {tipExceedsVisit(props.rows, props.lines) ? (
        <p role="status">{t(props.locale, 'sessionTips.exceedsVisit')}</p>
      ) : null}
    </>
  );
}
