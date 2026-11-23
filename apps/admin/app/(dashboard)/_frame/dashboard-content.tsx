'use client';

import { t } from '@pospay/i18n';
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { CircleAlert, EmptyState } from '@pospay/ui';

import { useSession } from '@/session/api/use-session';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';
import { WorkspaceBody } from '@/workspace/ui/workspace-body';

const LINKED_WORKSPACE_PAGE = /^\/orders\/customers\/[^/]+\/packages\/?$/;
// المظهر والمصادقة يفتحهما كل مستخدم مسجّل ولو لم تُحمَّل مساحة عمله أو لم يملك واحدة (FR-005).
const NO_WORKSPACE_PAGE = /^\/(?:appearance|security\/two-factor)\/?$/;

/**
 * محتوى الصفحة داخل الإطار: تنبيه خطأ الجلسة، ثم بوابة مساحة العمل حول الصفحة.
 * صفحات NO_WORKSPACE_PAGE تتجاوز البوابة بقاعدة مسمّاة هنا بجانب قاعدة المساحة المرتبطة، لا ببوابة ثانية.
 */
export function DashboardContent({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const mounted = useMounted();
  const session = useSession(mounted);
  const pathname = usePathname();
  const allowsLinkedWorkspace = LINKED_WORKSPACE_PAGE.test(pathname);
  const needsNoWorkspace = NO_WORKSPACE_PAGE.test(pathname);
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
        <WorkspaceBody allowsLinkedWorkspace={allowsLinkedWorkspace}>{children}</WorkspaceBody>
      )}
    </>
  );
}
