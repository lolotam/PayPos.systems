const NAME = 'pospay-personal-session-change';
const TAB_SENDER =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
const localListeners = new Set<() => void>();

function isSameTabBroadcast(data: unknown): boolean {
  return (
    typeof data === 'object' && data !== null && 'sender' in data && data.sender === TAB_SENDER
  );
}

function channel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(NAME);
  } catch {
    return null;
  }
}
export function observePersonalChange(clear: () => void) {
  localListeners.add(clear);
  const source = channel();
  if (source !== null) {
    source.onmessage = (event: MessageEvent<unknown>) => {
      // استرجاع نفس التبويب تم مسحه فوراً، فتجاهل صدى BroadcastChannel عشان ما يحصلش مسح مكرر متأخر.
      if (isSameTabBroadcast(event.data)) return;
      clear();
    };
  }
  const storage = (event: StorageEvent) => {
    if (event.key === NAME) clear();
  };
  window.addEventListener('storage', storage);
  return () => {
    localListeners.delete(clear);
    source?.close();
    window.removeEventListener('storage', storage);
  };
}
export function announcePersonalChange() {
  // مسح كاش التبويب الحالي يتم فوراً قبل القنوات غير المتزامنة عشان إعادة التركيب ما تقراش جلسة منتهية.
  for (const listener of [...localListeners]) listener();
  const source = channel();
  try {
    source?.postMessage({ type: 'CHANGED', sender: TAB_SENDER });
  } catch {
    /* فشل القناة لا يبقي cache محلياً. */
  } finally {
    source?.close();
  }
  try {
    localStorage.setItem(NAME, String(Date.now()));
  } catch {
    /* إشارة فقط بلا هوية أو إثبات. */
  }
}
