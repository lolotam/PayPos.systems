import { cookies } from 'next/headers';

import type { NavigationStyle } from '@/workspace/nav-types';

import { parseNavigationStyle } from '../navigation-model';
import { NAV_STYLE_COOKIE } from './nav-style-cookie';

export async function readRequestNavStyle(): Promise<NavigationStyle> {
  const jar = await cookies();
  return parseNavigationStyle(jar.get(NAV_STYLE_COOKIE)?.value);
}
