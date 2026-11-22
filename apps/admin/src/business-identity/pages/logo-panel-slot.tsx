'use client';

import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import { useBusinessLogo } from '../api/use-business-logo';
import type { OfficialNames } from '../model/changed-official-names';
import { logoAltText } from '../model/logo-alt';
import { LogoPanel } from '../ui/logo-panel';

type Scope = { companyId: string; userId: string; businessId: string };

/**
 * خانة الشعار الجاهزة للعمود: تستدعي قراءة الشعار بنفسها وتركّب كل ما يمرّره
 * `LogoPanel`، حتى يبقى تركيب الأعمدة في `IdentityColumns` تركيبًا فقط.
 */
export function LogoPanelSlot({
  scope,
  logoId,
  baseline,
}: {
  scope: Scope;
  /** خطأ القراءة من غير صف يسيب المعرف مجهولًا؛ null وحده يعني مفيش شعار. */
  logoId: string | null | undefined;
  baseline: OfficialNames | null;
}) {
  const locale = useLocale();
  const logo = useBusinessLogo(scope.companyId, scope.userId, scope.businessId);
  return (
    <LogoPanel
      companyId={scope.companyId}
      userId={scope.userId}
      logoId={logoId}
      alt={logoAltText(locale, baseline) ?? t(locale, 'businessIdentity.logoAlt')}
      phase={logo.phase}
      pending={logo.upload.isPending}
      removing={logo.remove.isPending}
      failure={logo.failure}
      removeFailure={logo.removeFailure}
      removed={logo.removed && logoId === null}
      onUpload={(file) => logo.upload.mutate(file)}
      onRemove={() => logo.remove.mutateAsync()}
    />
  );
}
