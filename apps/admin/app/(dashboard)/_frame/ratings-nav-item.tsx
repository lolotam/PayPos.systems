'use client';

import { t } from '@pospay/i18n';
import { AppSidebarItem, Star } from '@pospay/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRatingsAccess } from '@/ratings/api/use-ratings-access';
import { useSessionUser } from '@/session/api/use-session';
import { readAccessProof } from '@/shared/api/read-access-proof';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';
import { useWorkspace } from '@/workspace/model/workspace-provider';

export function RatingsNavItem() {
  const locale = useLocale();
  const pathname = usePathname();
  const userId = useSessionUser(useMounted());
  const workspace = useWorkspace();
  const ready = workspace.status === 'ready' ? workspace : null;
  const access = useRatingsAccess(ready?.company.id, userId, ready?.business?.id);
  // الرابط بيظهر بعد نجاح قراءة حالية من الخادم، والرفض أو الفشل بيخفيه.
  if (!ready?.business || userId === null) return null;
  if (readAccessProof(access) !== 'granted') return null;
  return (
    <AppSidebarItem
      asChild
      icon={<Star />}
      label={t(locale, 'ratings.title')}
      active={pathname === '/ratings'}
    >
      <Link href="/ratings" />
    </AppSidebarItem>
  );
}
