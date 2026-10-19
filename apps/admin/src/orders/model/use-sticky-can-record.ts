'use client';
import { useState } from 'react';

function recordingProbeDenied(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const status = (error as { status?: unknown }).status;
  return status === 401 || status === 403;
}

function nextAllowed(previous: boolean, query: { isSuccess: boolean; error: unknown }): boolean {
  if (query.isSuccess) return true;
  if (recordingProbeDenied(query.error)) return false;
  return previous;
}

// بعد أول نجاح، فشل الشبكة أو 5xx ما يخفيش أزرار الإكرامية. 401 و403 بس هما اللي يخفوها.
export function useStickyCanRecord(query: { isSuccess: boolean; error: unknown }): boolean {
  const [allowed, setAllowed] = useState(false);
  const next = nextAllowed(allowed, query);
  if (next !== allowed) setAllowed(next);
  return next;
}
