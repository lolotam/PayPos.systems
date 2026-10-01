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

export function listenForIdentityChanges(onChange: () => void): () => void {
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
