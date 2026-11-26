'use client';

import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useState } from 'react';

import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';

import { formatCountdown } from '../model/devices-countdown';

// بطاقة كود الربط: الكود بيتكتب على جهاز الكاونتر، والعدّاد بيقول المدير قد إيه فاضل.
export function PairingCodeCard({
  code,
  remaining,
  issuing,
  issuedAtLabel,
  issueError,
  onGenerate,
}: {
  code: string | null;
  remaining: number;
  issuing: boolean;
  issuedAtLabel: string | null;
  issueError: unknown;
  onGenerate: () => void;
}) {
  const locale = useLocale();
  return (
    <section aria-labelledby="devices-pairing" className="flex flex-col gap-3">
      <h2 id="devices-pairing" className="text-lg font-semibold">
        {t(locale, 'devices.pairingTitle')}
      </h2>
      <p className="text-sm text-muted-foreground">{t(locale, 'devices.pairingLead')}</p>
      {code === null ? null : (
        <LiveCodeBlock code={code} remaining={remaining} issuedAtLabel={issuedAtLabel} />
      )}
      <p className="text-xs text-muted-foreground">{t(locale, 'devices.replacesPreviousHint')}</p>
      {issueError === null || issueError === undefined ? null : (
        <p role="alert" className="text-sm text-destructive">
          {envelopeMessage(issueError, locale)}
        </p>
      )}
      <div>
        <Button type="button" onClick={onGenerate} disabled={issuing}>
          {issuing
            ? t(locale, 'devices.generatingCode')
            : code === null
              ? t(locale, 'devices.generateCode')
              : t(locale, 'devices.regenerateCode')}
        </Button>
      </div>
    </section>
  );
}

function LiveCodeBlock({
  code,
  remaining,
  issuedAtLabel,
}: {
  code: string;
  remaining: number;
  issuedAtLabel: string | null;
}) {
  const locale = useLocale();
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const copied = copiedCode === code;
  const expired = remaining <= 0;

  const copy = async () => {
    if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') {
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
    } catch {
      setCopiedCode(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-muted-foreground">
        {t(locale, 'devices.activeCodeLabel')}
      </span>
      <p
        data-testid="pairing-code-value"
        dir="ltr"
        className="font-mono text-4xl font-bold tracking-[0.3em] text-foreground"
      >
        {code}
      </p>
      <p className="text-sm text-muted-foreground">
        {expired ? (
          <span role="status">{t(locale, 'devices.codeExpired')}</span>
        ) : (
          <span>
            {t(locale, 'devices.expiresIn')}{' '}
            <span data-testid="pairing-code-countdown">{formatCountdown(remaining)}</span>
          </span>
        )}
      </p>
      {issuedAtLabel === null ? null : (
        <p className="text-xs text-muted-foreground">
          {t(locale, 'devices.issuedAt')}: {issuedAtLabel}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={() => void copy()}>
          {copied ? t(locale, 'devices.copiedCode') : t(locale, 'devices.copyCode')}
        </Button>
      </div>
    </div>
  );
}
