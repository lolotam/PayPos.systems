'use client';

import { t } from '@pospay/i18n';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import type { LogoPhase } from '../api/upload-business-logo';
import { LogoFileForm } from './logo-file-form';
import { LogoPreview } from './logo-preview';
import { LogoStatus } from './logo-status';
import { RemoveLogoDialog } from './remove-logo-dialog';

export function LogoPanel({
  companyId,
  logoId,
  alt,
  phase,
  pending,
  removing,
  failure,
  removed,
  onUpload,
  onRemove,
}: {
  companyId: string;
  logoId: string | null;
  alt: string;
  phase: LogoPhase;
  pending: boolean;
  removing: boolean;
  failure: unknown;
  removed: boolean;
  onUpload: (file: File) => void;
  onRemove: () => void;
}) {
  const locale = useLocale();
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const confirming = openedFor !== null && openedFor === logoId && !removed;
  return (
    <section
      className="flex flex-col gap-3 text-start"
      aria-label={t(locale, 'businessIdentity.logoTitle')}
    >
      <h2 className="text-lg font-semibold">{t(locale, 'businessIdentity.logoTitle')}</h2>
      <p className="text-sm text-muted-foreground">{t(locale, 'businessIdentity.logoHint')}</p>
      <LogoPreview
        key={`${companyId}:${logoId ?? ''}`}
        companyId={companyId}
        fileId={logoId}
        alt={alt}
      />
      <LogoFileForm
        logoId={logoId}
        pending={pending || removing}
        onUpload={onUpload}
        onAskRemove={() => {
          if (logoId) setOpenedFor(logoId);
        }}
      />
      <LogoStatus phase={phase} failure={failure} />
      {removed ? <p role="status">{t(locale, 'businessIdentity.removed')}</p> : null}
      {confirming ? (
        <RemoveLogoDialog
          pending={removing}
          onClose={() => setOpenedFor(null)}
          onConfirm={onRemove}
        />
      ) : null}
    </section>
  );
}
