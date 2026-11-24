'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import type { NavigationStyle } from '@/workspace/nav-types';
import { useNavStyleSaver } from '@/shared/nav-style/use-nav-style-saver';

import { writeNavStyleCookie } from './nav-style-cookie';

interface NavStyleController {
  style: NavigationStyle;
  setStyle: (style: NavigationStyle) => void;
  saveFailed: boolean;
}

const NavStyleContext = createContext<NavStyleController | null>(null);

export function NavStyleProvider({
  initialStyle,
  children,
}: {
  initialStyle: NavigationStyle;
  children: ReactNode;
}) {
  const [style, setCurrent] = useState(initialStyle);
  const { failed, save } = useNavStyleSaver();
  const setStyle = useCallback(
    (next: NavigationStyle) => {
      setCurrent(next);
      writeNavStyleCookie(next);
      save(next);
    },
    [save],
  );
  const value = useMemo(() => ({ style, setStyle, saveFailed: failed }), [style, setStyle, failed]);
  return <NavStyleContext.Provider value={value}>{children}</NavStyleContext.Provider>;
}

export function useNavStyle(): NavStyleController {
  const value = useContext(NavStyleContext);
  if (!value) throw new Error('NavStyleProvider is missing');
  return value;
}
