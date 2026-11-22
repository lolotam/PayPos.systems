'use client';

import { t } from '@pospay/i18n';
import { usePathname } from 'next/navigation';
import { useMemo } from 'react';

import { useLocale } from '@/shared/locale/locale-context';

import type { MenuContext } from './menu-context';
import { navigationIcon } from './navigation-icons';
import { useVisiblePageIds } from './use-visible-page-ids';

/** سياق بناء القوائم للإطار الحالي: اللغة والمسار والصفحات المرئية الآن. */
export function useMenuContext(): MenuContext {
  const locale = useLocale();
  const pathname = usePathname();
  const visibleIds = useVisiblePageIds();
  return useMemo(
    () => ({
      translate: (key) => t(locale, key),
      pathname,
      visibleIds,
      icon: navigationIcon,
    }),
    [locale, pathname, visibleIds],
  );
}
