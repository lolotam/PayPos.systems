import type { MessageKey } from '@pospay/i18n';
import type { ReactNode } from 'react';

import type { NavigationIconName } from '@/workspace/nav-types';

/** كل ما يحتاجه بناء قائمة واحدة: الترجمة والمسار الحالي والصفحات المرئية والأيقونات. */
export interface MenuContext {
  translate: (key: MessageKey) => string;
  pathname: string;
  visibleIds: readonly string[];
  icon?: ((name: NavigationIconName) => ReactNode) | undefined;
}
