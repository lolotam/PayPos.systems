'use client';

import type { UpdateBusinessIdentityNamesInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import type { LogoPhase } from '../api/upload-business-logo';
import type { OfficialNames } from '../model/changed-official-names';
import { identityFailureMessage } from '../model/identity-failure';
import { LogoPanel } from '../ui/logo-panel';
import { OfficialNamesForm } from '../ui/official-names-form';

export function IdentityEditor(props: {
  companyId: string;
  userId: string;
  showNames: boolean;
  baseline: OfficialNames | null;
  saved: OfficialNames | null;
  logoId: string | null | undefined;
  alt: string;
  namesPending: boolean;
  namesSaved: boolean;
  namesError: unknown;
  phase: LogoPhase;
  uploadPending: boolean;
  removing: boolean;
  failure: unknown;
  removeFailure: unknown;
  removed: boolean;
  onSave: (body: UpdateBusinessIdentityNamesInput) => void;
  onUpload: (file: File) => void;
  onRemove: () => Promise<unknown>;
}) {
  const locale = useLocale();
  return (
    <>
      {props.showNames ? (
        <>
          <OfficialNamesForm
            baseline={props.baseline}
            saved={props.saved}
            pending={props.namesPending}
            onSave={props.onSave}
          />
          {props.namesSaved ? <p role="status">{t(locale, 'businessIdentity.saved')}</p> : null}
          {props.namesError ? (
            <p role="alert">{identityFailureMessage(props.namesError, locale)}</p>
          ) : null}
        </>
      ) : null}
      <LogoPanel
        companyId={props.companyId}
        userId={props.userId}
        logoId={props.logoId}
        alt={props.alt}
        phase={props.phase}
        pending={props.uploadPending}
        removing={props.removing}
        failure={props.failure}
        removeFailure={props.removeFailure}
        removed={props.removed}
        onUpload={props.onUpload}
        onRemove={props.onRemove}
      />
    </>
  );
}
