'use client';

import { t } from '@pospay/i18n';
import type { ReactNode } from 'react';
import { Fragment } from 'react';
import { usePathname } from 'next/navigation';
import { CircleAlert, EmptyState } from '@pospay/ui';

import { useSession } from '@/session/api/use-session';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';
import { useWorkspace } from '@/workspace/model/workspace-provider';
import { WorkspaceBody } from '@/workspace/ui/workspace-body';

const LINKED_WORKSPACE_PAGE = /^\/orders\/customers\/[^/]+\/packages\/?$/;
// المظهر والمصادقة يفتحهما كل مستخدم مسجّل ولو لم تُحمَّل مساحة عمله أو لم يملك واحدة (FR-005).
const NO_WORKSPACE_PAGE = /^\/(?:appearance|security\/two-factor)\/?$/;
// صفحتان يقرران «غير موجود» من قرار محلي (الدور ونوع النشاط) لا من العنوان، وحدّ not-found في Next لا يستاعد إلا بتنقل.
const REMOUNTS_ON_WORKSPACE_CHANGE = /^\/(?:approvals|soon\/[^/]+)\/?$/;

/**
 * محتوى الصفحة داخل الإطار: تنبيه خطأ الجلسة، ثم بوابة مساحة العمل حول الصفحة.
 * صفحات NO_WORKSPACE_PAGE تتجاوز البوابة بقاعدة مسمّاة هنا بجانب قاعدة المساحة المرتبطة، لا ببوابة ثانية.
 * صفحتا /approvals و/soon تُعاد بتركيبهما عند تبديل الشركة أو النشاط بمفتاح المعرّفات، فبعد «غير موجود»
 * ورجوع المستخدم إلى نشاط تُرى عنده الصفحة على العنوان نفسه، يعيد المفتاح تشغيل الصفحة وقرارها المحلي.
 */
export function DashboardContent({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const mounted = useMounted();
  const session = useSession(mounted);
  const pathname = usePathname();
  const workspace = useWorkspace();
  const allowsLinkedWorkspace = LINKED_WORKSPACE_PAGE.test(pathname);
  const needsNoWorkspace = NO_WORKSPACE_PAGE.test(pathname);
  const workspaceKey =
    REMOUNTS_ON_WORKSPACE_CHANGE.test(pathname) && workspace.status === 'ready'
      ? `${workspace.company.id}:${workspace.business?.id ?? ''}`
      : null;
  return (
    <>
      {session.isError ? (
        <EmptyState
          role="alert"
          className="mb-12"
          tone="danger"
          icon={<CircleAlert />}
          title={t(locale, 'admin.unexpected')}
        />
      ) : null}
      {needsNoWorkspace ? (
        children
      ) : (
        <WorkspaceBody allowsLinkedWorkspace={allowsLinkedWorkspace}>
          {workspaceKey === null ? children : <Fragment key={workspaceKey}>{children}</Fragment>}
        </WorkspaceBody>
      )}
    </>
  );
}
