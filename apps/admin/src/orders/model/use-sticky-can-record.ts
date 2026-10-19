'use client';
import { useRef } from 'react';

function recordingProbeDenied(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const status = (error as { status?: unknown }).status;
  return status === 401 || status === 403;
}

// بعد أول نجاح، فشل الشبكة أو 5xx ما يفكّش أزرار الإكرامية. 401 و403 بس هما اللي يرجّعوا الزر.
export function useStickyCanRecord(query: { isSuccess: boolean; error: unknown }): boolean {
  const allowed = useRef(false);
  if (query.isSuccess) allowed.current = true;
  else if (recordingProbeDenied(query.error)) allowed.current = false;
  return allowed.current;
}
