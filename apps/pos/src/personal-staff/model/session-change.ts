const NAME = 'pospay-personal-session-change';
function channel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(NAME);
  } catch {
    return null;
  }
}
export function observePersonalChange(clear: () => void) {
  const source = channel();
  if (source !== null) source.onmessage = clear;
  const storage = (event: StorageEvent) => {
    if (event.key === NAME) clear();
  };
  window.addEventListener('storage', storage);
  return () => {
    source?.close();
    window.removeEventListener('storage', storage);
  };
}
export function announcePersonalChange() {
  const source = channel();
  try {
    source?.postMessage('CHANGED');
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
