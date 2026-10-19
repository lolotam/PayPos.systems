'use client';

import { t } from '@pospay/i18n';
import { PageHeader } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { useBusinessLogo } from '../api/use-business-logo';
import { useBusinessSettings } from '../api/use-business-settings';
import { useOfficialNames } from '../api/use-official-names';
import { identityFailureMessage, isIdentityReadForbidden } from '../model/identity-failure';
import { logoAltText } from '../model/logo-alt';
import { IdentityEditor } from './identity-editor';

type Scope = { companyId: string; userId: string; businessId: string };

export function BusinessIdentityPage(scope: Scope) {
  const locale = useLocale();
  const settings = useBusinessSettings(scope.companyId, scope.userId, scope.businessId);
  const names = useOfficialNames(scope.companyId, scope.userId, scope.businessId);
  const logo = useBusinessLogo(scope.companyId, scope.userId, scope.businessId);
  const readForbidden = settings.isError && isIdentityReadForbidden(settings.error);
  const baseline = settings.data
    ? {
        official_name_ar: settings.data.official_name_ar,
        official_name_en: settings.data.official_name_en,
      }
    : (names.data ?? null);
  const logoId = settings.data ? settings.data.logo_file_id : (logo.writtenId ?? null);
  const showEditor = settings.isSuccess || readForbidden;
  return (
    <section className="flex min-w-0 flex-col gap-8 text-start">
      <PageHeader
        title={t(locale, 'businessIdentity.title')}
        description={t(locale, 'businessIdentity.lead')}
      />
      {settings.isPending ? <p role="status">{t(locale, 'admin.loading')}</p> : null}
      {settings.isError && !readForbidden ? (
        <p role="alert">{identityFailureMessage(settings.error, locale)}</p>
      ) : null}
      {showEditor ? (
        <IdentityEditor
          companyId={scope.companyId}
          baseline={baseline}
          logoId={logoId}
          alt={logoAltText(locale, baseline) ?? t(locale, 'businessIdentity.logoAlt')}
          namesPending={names.isPending}
          namesSaved={names.isSuccess}
          namesError={names.isError ? names.error : null}
          phase={logo.phase}
          uploadPending={logo.upload.isPending}
          removing={logo.remove.isPending}
          failure={logo.failure}
          removed={logo.removed}
          onSave={(body) => names.mutate(body)}
          onUpload={(file) => logo.upload.mutate(file)}
          onRemove={() => logo.remove.mutate()}
        />
      ) : null}
    </section>
  );
}
