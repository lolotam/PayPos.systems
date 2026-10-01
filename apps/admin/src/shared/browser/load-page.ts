const identityChannel = 'pospay:identity-change';
const sourceId = globalThis.crypto.randomUUID();

function openIdentityChannel(): BroadcastChannel | undefined {
  if (typeof globalThis.BroadcastChannel !== 'function') return undefined;
  try {
    return new BroadcastChannel(identityChannel);
  } catch {
    // بعض المتصفحات تمنع القناة؛ التنقل المحلي يظل متاحاً.
    return undefined;
  }
}

const identityKey = 'pospay:identity-change';

// احتياطي لكل المتصفحات: تغيير مفتاح في localStorage بيطلع حدث storage في كل التبويبات التانية بس.
function listenForStorageChanges(onChange: () => void): () => void {
  if (typeof globalThis.addEventListener !== 'function') return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key === identityKey && event.newValue !== null) onChange();
  };
  globalThis.addEventListener('storage', onStorage);
  return () => globalThis.removeEventListener('storage', onStorage);
}

function announceToStorage(): void {
  try {
    globalThis.localStorage.setItem(identityKey, `${sourceId}:${Date.now()}`);
  } catch {
    // التخزين ممكن يكون مقفول؛ القناة وإعادة قراءة الهوية عند الرجوع للتبويب بيغطّوا الحالة دي.
  }
}

export function listenForIdentityChanges(onChange: () => void): () => void {
  let fired = false;
  const once = () => {
    if (fired) return;
    fired = true;
    onChange();
  };
  const stopStorage = listenForStorageChanges(once);
  const stopChannel = listenForChannel(once);
  return () => {
    stopStorage();
    stopChannel();
  };
}

function listenForChannel(onChange: () => void): () => void {
  const channel = openIdentityChannel();
  if (channel === undefined) return () => undefined;
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const message = event.data;
    if (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      message.type === 'identity-change' &&
      'source' in message &&
      typeof message.source === 'string' &&
      message.source !== sourceId
    )
      onChange();
  };
  return () => channel.close();
}

// تغيير الهوية يمس كل تبويب؛ الرسالة لا تحمل أي بيانات مستخدم أو جلسة.
export function loadPage(path: string): void {
  announceToStorage();
  const channel = openIdentityChannel();
  try {
    channel?.postMessage({ type: 'identity-change', source: sourceId });
  } catch {
    // فشل البث لا يؤخر الصفحة الجديدة التي تزيل كاش المستخدم السابق.
  } finally {
    channel?.close();
  }
  globalThis.location.assign(path);
}
