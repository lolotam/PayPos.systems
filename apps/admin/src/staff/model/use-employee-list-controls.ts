'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

const SEARCH_DEBOUNCE_MS = 300;

/**
 * المؤشر بيرجع لأول صفحة مع النص المستقر، عشان صفحة قديمة ما تتبعتش مع بحث جديد.
 * onSettled بيقفل الموظفة المفتوحة، لأنها ممكن ما تكونش في نتيجة البحث الجديد.
 * paused بيمنع تطبيق المؤقت؛ ولما يرجع false النص المعلّق بيتطبّق مرة واحدة.
 */
export function useEmployeeListControls(onSettled?: () => void, paused = false) {
  const [text, setText] = useState('');
  const [q, setQ] = useState<string | undefined>();
  const [cursor, setCursor] = useState<string | undefined>();
  const settled = useRef('');
  const wasPaused = useRef(false);
  const pausedRef = useRef(paused);
  const notify = useRef(onSettled);
  pausedRef.current = paused;
  notify.current = onSettled;
  const trimmed = text.trim();
  const publish = useCallback((trimmedText: string) => {
    settled.current = trimmedText;
    setQ(trimmedText === '' ? undefined : trimmedText);
    setCursor(undefined);
    notify.current?.();
  }, []);
  useEffect(() => {
    const resume = wasPaused.current && !paused;
    wasPaused.current = paused;
    if (resume && settled.current !== trimmed) publish(trimmed);
  }, [paused, trimmed, publish]);
  useEffect(() => {
    if (paused || settled.current === trimmed) return;
    const timer = setTimeout(() => {
      if (pausedRef.current || settled.current === trimmed) return;
      publish(trimmed);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed, paused, publish]);
  return { text, q, cursor, onSearch: setText, onPage: setCursor };
}
