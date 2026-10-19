'use client';
import { parseMoney } from '@pospay/domain';
import { formatKwd, t, type Locale } from '@pospay/i18n';
import { tipExceedsVisit, tipMethodTotals, type TipAmountRow } from '../model/session-tip-body';
import { tipRefusalMessage } from '../model/session-tip-outcome';
import type { TipSourceLine } from '../model/session-tip-source';

export function SessionTipsMethodTotals(props: {
  locale: Locale;
  rows: readonly TipAmountRow[];
  lines: readonly TipSourceLine[];
  netsKnown: boolean;
}) {
  const totals = tipMethodTotals(props.rows);
  const size = tipExceedsVisit(props.rows, props.lines);
  const tooLarge = totals.status === 'too-large' || size === 'too-large';
  return (
    <>
      {tooLarge ? (
        <p role="alert">{tipRefusalMessage({ code: 'TIP_TOTAL_TOO_LARGE' }, props.locale)}</p>
      ) : null}
      {totals.status === 'ok' ? (
        <p>
          {t(props.locale, 'sessionTips.cashTotal')}{' '}
          <bdi>{formatKwd(parseMoney(totals.total_cash))}</bdi>{' '}
          {t(props.locale, 'sessionTips.cardTotal')}{' '}
          <bdi>{formatKwd(parseMoney(totals.total_card))}</bdi>
        </p>
      ) : null}
      {props.netsKnown && size === 'exceeds' ? (
        <p role="status">{t(props.locale, 'sessionTips.exceedsVisit')}</p>
      ) : null}
    </>
  );
}
