'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { NavStyle } from '@pospay/contracts';

import { listenForIdentityChanges } from '@/shared/browser/load-page';

import { createNavStyleSaver } from './nav-style-saver';
import { saveAccountNavStyle } from './save-account-nav-style';

export function useNavStyleSaver() {
  const [failed, setFailed] = useState(false);
  const saver = useRef<ReturnType<typeof createNavStyleSaver> | null>(null);
  useEffect(() => {
    const current = createNavStyleSaver(saveAccountNavStyle, setFailed);
    saver.current = current;
    const stopListening = listenForIdentityChanges(() => current.stop());
    return () => { stopListening(); current.stop(); saver.current = null; };
  }, []);
  const save = useCallback((style: NavStyle) => saver.current?.choose(style), []);
  return { failed, save };
}
