'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { NavStyle } from '@pospay/contracts';

import { listenForIdentityChanges } from '@/shared/browser/load-page';

import { onNavStyleSavingStopped } from './nav-style-stop';
import { createNavStyleSaver } from './nav-style-saver';
import { saveAccountNavStyle } from './save-account-nav-style';

export function useNavStyleSaver() {
  const [failed, setFailed] = useState(false);
  const saver = useRef<ReturnType<typeof createNavStyleSaver> | null>(null);
  useEffect(() => {
    const current = createNavStyleSaver(saveAccountNavStyle, setFailed);
    saver.current = current;
    // الإشارة المحلية تكفي تبويب الدخول نفسه؛ وإشارة تبويب آخر تغطي تغيير الهوية من بره.
    const stopLocal = onNavStyleSavingStopped(() => current.stop());
    const stopListening = listenForIdentityChanges(() => current.stop());
    return () => {
      stopLocal();
      stopListening();
      current.stop();
      saver.current = null;
    };
  }, []);
  const save = useCallback((style: NavStyle) => saver.current?.choose(style), []);
  return { failed, save };
}
