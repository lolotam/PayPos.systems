'use client';

import { t } from '@pospay/i18n';
import type { ReactNode } from 'react';
import { Building2, CircleAlert, EmptyState, LoaderCircle } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';

import { useWorkspace } from '../model/workspace-provider';
import { CreateCompanyScreen } from './create-company-screen';
import { CreateFirstBranchScreen } from './create-first-branch-screen';
import { CreateFirstBusinessScreen } from './create-first-business-screen';

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
    // «مفيش نشاط» و«مفيش فرع» بيتفرّقوا عن «مختارش» بقوايم فاضية: قائمة فاضية معناها مفيش
    // اتعمل أصلًا فشاشة الإنشاء الأول هي اللي تظهر، وقائمة مش فاضية بتفضل لمحوّل الهيدر.
    // الفرع المختار بيتقدّم على قائمة فروع النشاط (مصدر الحقيقة في المزوّد هو نفسه) عشان أي
    // حالة جاهزة فيها فرع مختار تفضل رسم الصفحة العادي حتى لو القائمة فاضية مؤقتًا.
    if (workspace.company.businesses.length === 0) {
      return <CreateFirstBusinessScreen companyId={workspace.company.id} />;
    }
    if (
      workspace.business !== undefined &&
      workspace.branch === undefined &&
      workspace.business.branches.length === 0
    ) {
      return (
        <CreateFirstBranchScreen
          companyId={workspace.company.id}
          businessId={workspace.business.id}
        />
      );
    }
  }
  return children;
}
