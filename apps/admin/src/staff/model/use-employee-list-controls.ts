'use client';
import { useEffect, useRef, useState } from 'react';

const SEARCH_DEBOUNCE_MS = 300;

/**
 * المؤشر بيرجع لأول صفحة مع النص المستقر، عشان صفحة قديمة ما تتبعتش مع بحث جديد.
 * onSettled بيقفل الموظفة المفتوحة، لأنها ممكن ما تكونش في نتيجة البحث الجديد.
 */
export function useEmployeeListControls(onSettled?: () => void) {
  const [text, setText] = useState('');
  const [q, setQ] = useState<string | undefined>();
  const [cursor, setCursor] = useState<string | undefined>();
  const settled = useRef('');
  const trimmed = text.trim();
  useEffect(() => {
    if (settled.current === trimmed) return;
    const timer = setTimeout(() => {
      settled.current = trimmed;
      setQ(trimmed === '' ? undefined : trimmed);
      setCursor(undefined);
      onSettled?.();
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed, onSettled]);
  return { text, q, cursor, onSearch: setText, onPage: setCursor };
}
