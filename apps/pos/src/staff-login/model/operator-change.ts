function operatorChannel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === 'undefined'
      ? null
      : new BroadcastChannel('pospay-staff-operator');
  } catch {
    return null;
  }
}

export function observeOperatorChange(clear: () => void): () => void {
  const channel = operatorChannel();
  if (channel !== null) channel.onmessage = () => clear();
  const storage = (event: StorageEvent) => {
    if (event.key === 'pospay-staff-operator-change') clear();
  };
  window.addEventListener('storage', storage);
  return () => {
    channel?.close();
    window.removeEventListener('storage', storage);
  };
}

export function announceOperatorChange(): void {
  const channel = operatorChannel();
  try {
    channel?.postMessage('CHANGED');
  } catch {
    /* فشل القناة لا يمنع إبطال cache محلياً أو تجربة إشارة التخزين. */
  } finally {
    channel?.close();
  }
  try {
    const previous = Number(localStorage.getItem('pospay-staff-operator-change') ?? '0');
    const signal = Math.max(Date.now(), Number.isFinite(previous) ? previous + 1 : 0);
    localStorage.setItem('pospay-staff-operator-change', String(signal));
  } catch {
    /* غياب التخزين لا يضع بيانات شخصية فيه؛ التحقق الدوري يعيد فحص الخادم. */
  }
}
