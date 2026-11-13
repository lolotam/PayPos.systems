'use client';
import { parseMoney } from '@pospay/domain';
import { discountApprovalRefusals, formatKwd, t } from '@pospay/i18n';
import { Button, Card } from '@pospay/ui';
import { useEffect, useRef } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import type { SessionServiceScope } from '../api/use-session-services';
import { sessionBpsText, sessionResultFrozen, type SessionRecordingResult } from '../model/session-recording-result';
import { SessionDiscountApproval } from './session-discount-approval';

export function SessionRejectedLines({ result, onEdit, scope, online = false }: {
  result: SessionRecordingResult; onEdit: (localId: string) => void; scope?: SessionServiceScope; online?: boolean;
}) {
  const locale = useLocale(), firstError = useRef<HTMLParagraphElement>(null), frozen = sessionResultFrozen(result);
  useEffect(() => { if (!frozen) firstError.current?.focus(); }, [result.rejected, frozen]);
  if (!result.rejected.length) return null;
  return <section className="grid gap-3 text-start" aria-label={t(locale, 'serviceSessions.rejectedLines')}>
    {result.rejected.map(({ localId, error }, index) => <Card key={localId} className="grid gap-2 p-3">
      <p>{locale === 'ar' ? error.name_ar ?? error.name_en : error.name_en}</p>
      <p role="alert" id={`${localId}-server-error`} tabIndex={-1} ref={index === 0 ? firstError : undefined}>{envelopeMessage(error, locale)}</p>
      <dl><dt>{t(locale, 'serviceSessions.effectiveDiscount')}</dt><dd><bdi>{sessionBpsText(error.effective_discount_bps)}</bdi></dd>
        <dt>{t(locale, 'serviceSessions.discountLimitPercent')}</dt><dd><bdi>{sessionBpsText(error.limit_bps)}</bdi></dd>
        <dt>{t(locale, 'serviceSessions.minimumNet')}</dt><dd><bdi>{formatKwd(parseMoney(error.minimum_net))}</bdi></dd>
        <dt>{t(locale, 'serviceSessions.maxDiscount')}</dt><dd><bdi>{formatKwd(parseMoney(error.max_discount_amount))}</bdi></dd></dl>
      {parseMoney(error.price) < parseMoney(error.minimum_net) ? <p>{t(locale, 'serviceSessions.raisePrice')}</p> : null}
      {error.approval_refusal ? <p>{discountApprovalRefusals[error.approval_refusal][locale === 'ar' ? 'message_ar' : 'message_en']}</p> : null}
      <Button type="button" variant="outline" disabled={sessionResultFrozen(result)} onClick={() => onEdit(localId)}>{t(locale, 'serviceSessions.editRejected')}</Button>
    </Card>)}
    {scope ? <SessionDiscountApproval result={result} scope={scope} online={online} /> : null}
  </section>;
}
