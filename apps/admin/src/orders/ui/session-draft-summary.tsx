'use client';
import { discountPercentage, sessionMoney, type RecordingDiscountLimit } from '@pospay/contracts';
import { discountFromPercent, lineNet, moneyToString, parseMoney, sumMoney } from '@pospay/domain';
import { normalizeKwdInput, t, type Locale, type MessageKey } from '@pospay/i18n';
import { Card } from '@pospay/ui';
import { useFormContext, useWatch } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import type { SessionDraftForm, SessionDraftLine } from '../model/session-drafts';

const sources = { OWNER: 'serviceSessions.limitOwner', PERSON: 'serviceSessions.limitPerson',
  BUSINESS: 'serviceSessions.limitBusiness', NOT_CONFIGURED: 'serviceSessions.notConfigured' } satisfies Record<string, MessageKey>;
export function recorderLimitText(locale: Locale, limit: RecordingDiscountLimit) {
  const percent = limit.bps === null ? '' : String(limit.bps).padStart(3, '0').replace(/(..)$/, '.$1');
  return { value: limit.bps === null ? t(locale, 'serviceSessions.unlimited') : t(locale, 'serviceSessions.percentValue').replace('{value}', percent),
    source: t(locale, sources[limit.source]) };
}
function draftMoney(row: SessionDraftLine) {
  try {
    const price = parseMoney(sessionMoney.parse(normalizeKwdInput(row.price)));
    const discount = row.discount_kind === 'AMOUNT' ? parseMoney(sessionMoney.parse(normalizeKwdInput(row.discount_amount)))
      : discountFromPercent(price, discountPercentage.parse(row.discount_percentage));
    return { price, discount, net: lineNet(price, discount) };
  } catch { return null; }
}
export function SessionDraftSummary({ limit }: { limit?: RecordingDiscountLimit | null }) {
  const locale = useLocale(), { control } = useFormContext<SessionDraftForm>();
  const lines = useWatch({ control, name: 'lines' }), amounts = lines.map(draftMoney);
  const authority = limit ? recorderLimitText(locale, limit) : null;
  let total: string | null = null;
  try { if (amounts.every((value) => value !== null)) total = moneyToString(sumMoney(amounts.map((value) => value.net))); }
  catch { /* إجمالي المسودة قد يتجاوز مجال المال حتى لو كان كل بند صالحاً. */ }
  return <Card role="status" className="grid gap-2 p-3 text-start">
    {lines.map((row, index) => <div key={row.local_id}>
      <p>{t(locale, 'serviceSessions.lineNumber').replace('{n}', String(index + 1))}</p>
      {amounts[index] ? <dl>
        <dt>{t(locale, 'serviceSessions.price')}</dt><dd><bdi>{moneyToString(amounts[index].price)}</bdi></dd>
        <dt>{t(locale, 'serviceSessions.discountAmount')}</dt><dd><bdi>{moneyToString(amounts[index].discount)}</bdi></dd>
        <dt>{t(locale, 'serviceSessions.draftNet')}</dt><dd><bdi>{moneyToString(amounts[index].net)}</bdi></dd>
      </dl> : <p>{t(locale, 'serviceSessions.invalidDiscount')}</p>}
    </div>)}
    <p>{t(locale, 'serviceSessions.draftTotal')} <bdi>{total ?? t(locale, 'serviceSessions.draftUnavailable')}</bdi></p>
    {authority ? <><p>{t(locale, 'serviceSessions.limit')} <bdi>{authority.value}</bdi></p>
      <p>{t(locale, 'serviceSessions.limitSource')} <span>{authority.source}</span></p></> : null}
  </Card>;
}
