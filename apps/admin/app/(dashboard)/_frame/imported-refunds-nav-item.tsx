'use client';

import { t } from '@pospay/i18n';
import { AppSidebarItem, ArrowCounterClockwise } from '@pospay/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSessionUser } from '@/session/api/use-session';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';
import { useWorkspace } from '@/workspace/model/workspace-provider';
import { readAccessProof } from '@/shared/api/read-access-proof';
import { useImportedRefunds } from '@/settings/imported-refunds/api/use-imported-refunds';

export function ImportedRefundsNavItem() {
  const locale = useLocale();
  const pathname = usePathname();
  const userId = useSessionUser(useMounted());
  const workspace = useWorkspace();
  const ready = workspace.status === 'ready' ? workspace : null;
  const access = useImportedRefunds(ready?.company.id, userId, ready?.business?.id);
  // إثبات قراءة حالي لكل نطاق قبل إظهار العنصر: الكاش المتخزن لا يُظهر رابطًا، والرفض يخفيه،
  // ونتيجة نطاق قديم متأخرة بتتجاهل عشان الرابط ما يظهرش من تفويض مش حي.
  const proof = readAccessProof(access);
  if (!ready?.business || userId === null) return null;
  if (proof !== 'granted') return null;
  return (
    <AppSidebarItem
      asChild
      icon={<ArrowCounterClockwise />}
      label={t(locale, 'importedRefunds.title')}
      active={pathname === '/imported-refunds'}
    >
      <Link href="/imported-refunds" />
    </AppSidebarItem>
  );
}
