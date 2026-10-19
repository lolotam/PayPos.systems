'use client';

import { t, type MessageKey } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import type { LogoPhase } from '../api/upload-business-logo';
import { identityFailureMessage } from '../model/identity-failure';

const PHASE_KEY: Partial<Record<LogoPhase, MessageKey>> = {
  uploading: 'businessIdentity.uploading',
  verifying: 'businessIdentity.verifying',
  ready: 'businessIdentity.ready',
  rejected: 'businessIdentity.rejected',
};

export function LogoStatus({ phase, failure }: { phase: LogoPhase; failure: unknown }) {
  const locale = useLocale();
  const key = PHASE_KEY[phase];
  return (
    <>
      {failure ? <p role="alert">{identityFailureMessage(failure, locale)}</p> : null}
      {key ? <p role="status">{t(locale, key)}</p> : null}
    </>
  );
}
