'use client';
import { t } from '@pospay/i18n';
import { useSessionUser } from '@/session/api/use-session';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';
import { useWorkspace } from '@/workspace/model/workspace-provider';
import { businessScope } from '@/workspace/model/business-scope';
import { ServiceCategoriesScreen } from '@/catalog/pages/service-categories-screen';

export function ServiceCategoriesRoute() {
  const locale = useLocale();
  const userId = useSessionUser(useMounted());
  const workspace = useWorkspace();
  if (workspace.status !== 'ready' || userId === null) return null;
  if (!workspace.business) return <p>{t(locale, 'admin.chooseBusiness')}</p>;
  const scope = businessScope(workspace.business, workspace.company.scope);
  // لاحقة الفرع في المفتاح لعضوية الفرع بس: مستوى النشاط لو غيّر فرع الهيدر ما يفقدش
  // تعديلاته ومهام القفل المعلقة (202)، لأن الشاشة بنفس المفتاح ما بتعملش remount.
  const branchKey = scope === 'BRANCH' ? (workspace.branch?.id ?? '') : '';
  return (
    <ServiceCategoriesScreen
      key={`${workspace.company.id}:${workspace.business.id}:${userId}:${branchKey}`}
      companyId={workspace.company.id}
      business={workspace.business}
      userId={userId}
      companyScope={workspace.company.scope}
      rememberedBranchId={workspace.branch?.id}
    />
  );
}
