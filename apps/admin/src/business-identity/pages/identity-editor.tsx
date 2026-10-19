'use client';

import { t } from '@pospay/i18n';
import type { UpdateBusinessIdentityNamesInput } from '@pospay/contracts';
import { useLocale } from '@/shared/locale/locale-context';
import type { LogoPhase } from '../api/upload-business-logo';
import type { OfficialNames } from '../model/changed-official-names';
import { identityFailureMessage } from '../model/identity-failure';
import { LogoPanel } from '../ui/logo-panel';
import { OfficialNamesForm } from '../ui/official-names-form';

export function IdentityEditor(props: {
  companyId: string;
  baseline: OfficialNames | null;
  logoId: string | null;
  alt: string;
  namesPending: boolean;
  namesSaved: boolean;
  namesError: unknown;
  phase: LogoPhase;
  uploadPending: boolean;
  removing: boolean;
  failure: unknown;
  removed: boolean;
  onSave: (body: UpdateBusinessIdentityNamesInput) => void;
  onUpload: (file: File) => void;
  onRemove: () => void;
}) {
  const locale = useLocale();
  const namesKey = props.baseline
    ? `${props.baseline.official_name_ar ?? ''}\n${props.baseline.official_name_en ?? ''}`
    : 'unknown';
  return (
    <>
      <OfficialNamesForm
        key={namesKey}
        baseline={props.baseline}
        pending={props.namesPending}
        onSave={props.onSave}
      />
      {props.namesSaved ? <p role="status">{t(locale, 'businessIdentity.saved')}</p> : null}
      {props.namesError ? (
        <p role="alert">{identityFailureMessage(props.namesError, locale)}</p>
      ) : null}
      <LogoPanel
        companyId={props.companyId}
        logoId={props.logoId}
        alt={props.alt}
        phase={props.phase}
        pending={props.uploadPending}
        removing={props.removing}
        failure={props.failure}
        removed={props.removed}
        onUpload={props.onUpload}
        onRemove={props.onRemove}
      />
    </>
  );
}
