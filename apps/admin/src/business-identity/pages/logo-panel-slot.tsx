'use client';

import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import type { useBusinessLogo } from '../api/use-business-logo';
import type { OfficialNames } from '../model/changed-official-names';
import { logoAltText } from '../model/logo-alt';
import { LogoPanel } from '../ui/logo-panel';

type LogoQuery = ReturnType<typeof useBusinessLogo>;
type Scope = { companyId: string; userId: string; businessId: string };

/**
 * خانة الشعار الجاهزة للعمود: تركيب عارض فقط؛ حالة الرفع نفسها تعيش في
 * `IdentityColumns` الثابتة، فانتقال اللوحة بين العمودين ما بيلغيش رفعًا جارٍيًا.
 */
export function LogoPanelSlot({
  scope,
  logo,
  logoId,
  baseline,
}: {
  scope: Scope;
  logo: LogoQuery;
  /** خطأ القراءة من غير صف يسيب المعرف مجهولًا؛ null وحده يعني مفيش شعار. */
  logoId: string | null | undefined;
  baseline: OfficialNames | null;
}) {
  const locale = useLocale();
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
