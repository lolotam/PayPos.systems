'use client';
import { parseMoney } from '@pospay/domain';
import { formatKwd, t, type Locale } from '@pospay/i18n';
import { previewLineEdit, type EditLimitDetails, type EditLineFormInput } from '../model/edit-service-line-values';
import { sessionBpsText } from '../model/session-recording-result';

export type EditPreviewLine = { price: string; discount: string; net: string };
const kwd = (value: string) => formatKwd(parseMoney(value));

export function EditServiceLinePreview({ locale, line, price, kind, discount, limit, figuresKnown = true }: {
  locale: Locale; line: EditPreviewLine; price: string; kind: EditLineFormInput['discount_kind']; discount: string; limit: EditLimitDetails | null; figuresKnown?: boolean;
}) {
  const preview = previewLineEdit(price, kind, discount);
  return <div className="grid gap-1 text-start">
    {figuresKnown ? <p>{t(locale, 'serviceLineEdit.current')} <bdi>{kwd(line.price)}</bdi> <bdi>{kwd(line.discount)}</bdi> <bdi>{kwd(line.net)}</bdi></p> : null}
    {preview ? <p>{t(locale, 'serviceLineEdit.preview')} <bdi>{preview.discount}</bdi> <bdi>{preview.net}</bdi></p> : null}
    {limit ? <dl>
      <div><dt>{t(locale, 'serviceSessions.effectiveDiscount')}</dt><dd><bdi>{sessionBpsText(limit.effective_discount_bps)}</bdi></dd></div>
      <div><dt>{t(locale, 'serviceSessions.discountLimitPercent')}</dt><dd><bdi>{sessionBpsText(limit.limit_bps_applied)}</bdi></dd></div>
      <div><dt>{t(locale, 'serviceSessions.minimumNet')}</dt><dd><bdi>{kwd(limit.minimum_net)}</bdi></dd></div>
      <div><dt>{t(locale, 'serviceSessions.maxDiscount')}</dt><dd><bdi>{kwd(limit.max_discount_amount)}</bdi></dd></div>
    </dl> : null}
  </div>;
}
