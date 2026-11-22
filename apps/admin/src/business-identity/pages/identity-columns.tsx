'use client';

import { t } from '@pospay/i18n';
import { PageHeader, PageShell } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import type { useBusinessIdentity } from '../api/use-business-identity';
import type { useOfficialNames } from '../api/use-official-names';
import { identityFailureMessage, isAuthorizationRefusal } from '../model/identity-failure';
import { IdentityReadFailure } from '../ui/identity-read-failure';
import { IdentityEditor } from './identity-editor';
import { LogoPanelSlot } from './logo-panel-slot';

type IdentityQuery = ReturnType<typeof useBusinessIdentity>;
type NamesQuery = ReturnType<typeof useOfficialNames>;
type Scope = { companyId: string; userId: string; businessId: string };

/**
 * قالب هوية النشاط ثنائي الأعمدة: الأسماء الرسمية في العمود الرئيسي (2fr)
 * والشعار في الجانبي (1fr) من 1024px، متكدين الرئيسي أولًا تحته؛ ومن غير
 * كتلة الأسماء يأخذ الشعار العمود الرئيسي كاملًا ولا يترك في الضيق.
 */
export function IdentityColumns({
  scope,
  identity,
  names,
}: {
  scope: Scope;
  identity: IdentityQuery;
  names: NamesQuery;
}) {
  const locale = useLocale();
  const refused = isAuthorizationRefusal(identity.error);
  const showEditor = (identity.isSuccess || identity.isError) && !refused;
  const namesVisible = identity.data !== undefined;
  const baseline = identity.data
    ? {
        official_name_ar: identity.data.official_name_ar,
        official_name_en: identity.data.official_name_en,
      }
    : (names.data ?? null);
  // خطأ القراءة من غير صف يسيب المعرف مجهولًا؛ null وحده يعني مفيش شعار
  const logoId = identity.data === undefined ? undefined : identity.data.logo_file_id;
  const logoPanel = <LogoPanelSlot scope={scope} logoId={logoId} baseline={baseline} />;
  return (
    <PageShell
      layout="two-column"
      main={
        showEditor ? (
          namesVisible ? (
            <IdentityEditor
              baseline={baseline}
              saved={names.data ?? null}
              namesPending={names.isPending}
              namesSaved={names.isSuccess}
              namesError={names.isError ? names.error : null}
              onSave={(body) => names.mutate(body)}
            />
          ) : (
            logoPanel
          )
        ) : null
      }
      side={showEditor && namesVisible ? logoPanel : undefined}
    >
      <PageHeader
        title={t(locale, 'businessIdentity.title')}
        description={t(locale, 'businessIdentity.lead')}
      />
      {identity.isPending ? <p role="status">{t(locale, 'admin.loading')}</p> : null}
      {identity.isError ? (
        <IdentityReadFailure
          message={identityFailureMessage(identity.error, locale)}
          canRetry={!refused}
          onRetry={() => void identity.refetch()}
        />
      ) : null}
    </PageShell>
  );
}
