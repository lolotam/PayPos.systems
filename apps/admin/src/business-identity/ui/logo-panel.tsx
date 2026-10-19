'use client';

import { t } from '@pospay/i18n';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import type { LogoPhase } from '../api/upload-business-logo';
import { LogoFileForm } from './logo-file-form';
import { LogoPreview } from './logo-preview';
import { LogoStatus } from './logo-status';
import { RemoveLogoDialog } from './remove-logo-dialog';

function canConfirmRemoval(logoId: string | null | undefined, removed: boolean) {
  return !removed && (typeof logoId === 'string' || logoId === undefined);
}

function closeConfirmAfterRemoval(
  remove: () => Promise<unknown>,
  setConfirming: (open: boolean) => void,
) {
  // isPending ممكن ما يترسمش لو الرد جه قبل الرسم، فبنقفل التأكيد من نجاح الوعد.
  // الرفض متعالج في onError، والديالوج يفضل مفتوح عشان رسالة الفشل.
  void remove().then(
    () => setConfirming(false),
    () => undefined,
  );
}

type LogoPanelProps = {
  companyId: string;
  userId: string;
  logoId: string | null | undefined;
  alt: string;
  phase: LogoPhase;
  pending: boolean;
  removing: boolean;
  failure: unknown;
  removeFailure: unknown;
  removed: boolean;
  onUpload: (file: File) => void;
  onRemove: () => Promise<unknown>;
};

export function LogoPanel({
  companyId,
  userId,
  logoId,
  alt,
  phase,
  pending,
  removing,
  failure,
  removeFailure,
  removed,
  onUpload,
  onRemove,
}: LogoPanelProps) {
  const locale = useLocale();
  const [confirming, setConfirming] = useState(false);
  const dialogOpen = confirming && canConfirmRemoval(logoId, removed);
  const previewId = typeof logoId === 'string' ? logoId : null;
  const shownFailure = dialogOpen ? failure : (failure ?? removeFailure);
  return (
    <section
      className="flex flex-col gap-3 text-start"
      aria-label={t(locale, 'businessIdentity.logoTitle')}
    >
      <h2 className="text-lg font-semibold">{t(locale, 'businessIdentity.logoTitle')}</h2>
      <p className="text-sm text-muted-foreground">{t(locale, 'businessIdentity.logoHint')}</p>
      <LogoPreview
        key={`${companyId}:${userId}:${previewId ?? ''}`}
        companyId={companyId}
        userId={userId}
        fileId={previewId}
        alt={alt}
      />
      <LogoFileForm
        logoId={logoId}
        pending={pending || removing}
        onUpload={onUpload}
        onAskRemove={() => {
          if (canConfirmRemoval(logoId, removed)) setConfirming(true);
        }}
      />
      <LogoStatus phase={phase} failure={shownFailure} />
      {removed ? <p role="status">{t(locale, 'businessIdentity.removed')}</p> : null}
      {dialogOpen ? (
        <RemoveLogoDialog
          pending={removing}
          failure={removeFailure}
          onClose={() => setConfirming(false)}
          onConfirm={() => closeConfirmAfterRemoval(onRemove, setConfirming)}
        />
      ) : null}
    </section>
  );
}
