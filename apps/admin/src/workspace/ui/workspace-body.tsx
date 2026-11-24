'use client';

import { t } from '@pospay/i18n';
import type { ReactNode } from 'react';
import type { WorkspaceBranch, WorkspaceBusinessRead, WorkspaceCompanyRead } from '@pospay/contracts';
import { Building2, CircleAlert, EmptyState, LoaderCircle } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';

import { useWorkspace } from '../model/workspace-provider';
import { SETUP_BRANCH_ROLES, SETUP_BUSINESS_ROLES } from '../model/setup-role-defaults';
import { CreateCompanyScreen } from './create-company-screen';
import { CreateFirstBranchScreen } from './create-first-branch-screen';
import { CreateFirstBusinessScreen } from './create-first-business-screen';

type ReadyWorkspace = {
  company: WorkspaceCompanyRead;
  business?: WorkspaceBusinessRead | undefined;
  branch?: WorkspaceBranch | undefined;
};

/**
 * شاشة الإ setup المناسبة للحالة الجاهزة، ولا شيء من غيرها: «مفيش نشاط» و«مفيش فرع» بيتفرّقوا
 * عن «مختارش» بقوايم فاضية (قائمة فاضية معناها مفيش اتعمل أصلًا)، والفرع المختار بيتقدّم على
 * قائمة فروع النشاط. شاشات الإعداد لأدوار الإنشاء الافتراضية بس (قاعدة عرض، والـ API بيقرر)،
 * وصفحة المساحة المرتبطة (allowsLinkedWorkspace) بترسم محتواها دايمًا زي main.
 */
function setupScreenOf(
  workspace: ReadyWorkspace,
  allowsLinkedWorkspace: boolean,
): 'business' | 'branch' | null {
  if (allowsLinkedWorkspace) return null;
  const role = workspace.company.role_code;
  if (workspace.company.businesses.length === 0) {
    return SETUP_BUSINESS_ROLES.includes(role) ? 'business' : null;
  }
  if (
    workspace.business !== undefined &&
    workspace.branch === undefined &&
    workspace.business.branches.length === 0 &&
    SETUP_BRANCH_ROLES.includes(role)
  ) {
    return 'branch';
  }
  return null;
}

export function WorkspaceBody({
  children,
  allowsLinkedWorkspace = false,
}: {
  children: ReactNode;
  allowsLinkedWorkspace?: boolean;
}) {
  const locale = useLocale();
  const workspace = useWorkspace();
  if (workspace.status === 'loading') {
    return <EmptyState role="status" icon={<LoaderCircle />} title={t(locale, 'admin.loading')} />;
  }
  if (workspace.status === 'error') {
    return (
      <EmptyState role="alert" tone="danger" icon={<CircleAlert />} title={workspace.message} />
    );
  }
  if (workspace.status === 'empty') {
    return <CreateCompanyScreen />;
  }
  if (workspace.status === 'choose' && !allowsLinkedWorkspace) {
    return <EmptyState icon={<Building2 />} title={t(locale, 'admin.choosePrompt')} />;
  }
  if (workspace.status === 'ready') {
    const setup = setupScreenOf(workspace, allowsLinkedWorkspace);
    if (setup === 'business') {
      // المفتاح بتاع الشركة: تبديل الشركة المختارة في نفس التبويب بيعيد تركيب النموذج فالقيم
      // المكتوبة والمفتاح الماسك وخطأ الانتظار بينضفوا بدل ما يتبعتوا للشركة الجديدة.
      return <CreateFirstBusinessScreen key={workspace.company.id} companyId={workspace.company.id} />;
    }
    if (setup === 'branch' && workspace.business !== undefined) {
      return (
        <CreateFirstBranchScreen
          key={`${workspace.company.id}-${workspace.business.id}`}
          companyId={workspace.company.id}
          businessId={workspace.business.id}
        />
      );
    }
  }
  return children;
}
