'use client';

import { t } from '@pospay/i18n';
import { PageHeader } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { useBusinessIdentity } from '../api/use-business-identity';
import { useBusinessLogo } from '../api/use-business-logo';
import { useOfficialNames } from '../api/use-official-names';
import { identityFailureMessage, isAuthorizationRefusal } from '../model/identity-failure';
import { logoAltText } from '../model/logo-alt';
import { IdentityEditor } from './identity-editor';

type Scope = { companyId: string; userId: string; businessId: string };

export function BusinessIdentityPage(scope: Scope) {
  const locale = useLocale();
  const identity = useBusinessIdentity(scope.companyId, scope.userId, scope.businessId);
  const names = useOfficialNames(scope.companyId, scope.userId, scope.businessId);
  const logo = useBusinessLogo(scope.companyId, scope.userId, scope.businessId);
  const baseline = identity.data
    ? {
        official_name_ar: identity.data.official_name_ar,
        official_name_en: identity.data.official_name_en,
      }
    : (names.data ?? null);
  // خطأ القراءة من غير صف يسيب المعرف مجهولًا؛ null وحده يعني مفيش شعار
  const logoId = identity.data === undefined ? undefined : identity.data.logo_file_id;
  const showEditor = identity.isSuccess || identity.isError;
  const namesVisible = identity.data !== undefined && !isAuthorizationRefusal(identity.error);
  return (
    <section className="flex min-w-0 flex-col gap-8 text-start">
      <PageHeader
        title={t(locale, 'businessIdentity.title')}
        description={t(locale, 'businessIdentity.lead')}
      />
      {identity.isPending ? <p role="status">{t(locale, 'admin.loading')}</p> : null}
      {identity.isError ? (
        <p role="alert">{identityFailureMessage(identity.error, locale)}</p>
      ) : null}
      {showEditor ? (
        <IdentityEditor
          companyId={scope.companyId}
          userId={scope.userId}
          showNames={namesVisible}
          baseline={baseline}
          saved={names.data ?? null}
          logoId={logoId}
          alt={logoAltText(locale, baseline) ?? t(locale, 'businessIdentity.logoAlt')}
          namesPending={names.isPending}
          namesSaved={names.isSuccess}
          namesError={names.isError ? names.error : null}
          phase={logo.phase}
          uploadPending={logo.upload.isPending}
          removing={logo.remove.isPending}
          failure={logo.failure}
          removeFailure={logo.removeFailure}
          removed={logo.removed && logoId === null}
          onSave={(body) => names.mutate(body)}
          onUpload={(file) => logo.upload.mutate(file)}
          onRemove={() => logo.remove.mutateAsync()}
        />
      ) : null}
    </section>
  );
}
