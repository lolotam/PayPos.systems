'use client';

import { t } from '@pospay/i18n';
import { Button, EmptyState, CircleAlert } from '@pospay/ui';
import { useState } from 'react';

import { useLocale } from '@/shared/locale/locale-context';

export function BackupCodes({ codes }: { codes: readonly string[] }) {
  const locale = useLocale();
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  async function copy(): Promise<void> {
    setFailed(false);
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied(true);
    } catch {
      setCopied(false);
      setFailed(true);
    }
  }
  return (
    <div className="flex flex-col gap-2 rounded-interactive border border-border bg-secondary p-4">
      <p className="text-start text-sm font-medium">{t(locale, 'admin.backupCodesLabel')}</p>
      <p className="text-start text-sm text-muted-foreground">
        {t(locale, 'admin.backupCodesLead')}
      </p>
      <ul className="flex flex-col gap-1 font-mono text-sm">
        {codes.map((code, index) => (
          <li key={index}>{code}</li>
        ))}
      </ul>
      <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
        {copied ? t(locale, 'admin.copied') : t(locale, 'admin.copyBackupCodes')}
      </Button>
      {failed ? (
        <EmptyState
          role="alert"
          tone="danger"
          icon={<CircleAlert />}
          title={t(locale, 'admin.unexpected')}
          className="p-4"
        />
      ) : null}
    </div>
  );
}
