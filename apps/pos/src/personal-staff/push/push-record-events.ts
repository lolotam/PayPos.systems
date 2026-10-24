// إشعار داخل التبويب: السجل المحلي بيتغيّر من أماكن مختلفة (فحص التوقيع، التشغيل، الإيقاف،
// التدوير) والزر لازم يقرأ السجل الجديد. الملف ده مش في `push-record-idb.ts` عشان الـ
// service worker بيستورد الملف ده ومش هيقدر يشغّل إشعار في صفحة (ADR-0052 §7).

type Listener = () => void;

const CHANNEL_NAME = 'pospay-push-record';

const listeners = new Set<Listener>();

function channel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME);
  } catch {
    return null;
  }
}

/** بيقول لكل المستمعين في التبويب، ولكل التبويبات التانية، إن السجل المحلي اتغيّر. */
export function notifyPushRecordChanged(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // مستمع فاشل ما بيمنعش الباقي من يقرأ السجل.
    }
  }
  const source = channel();
  try {
    source?.postMessage('CHANGED');
  } catch {
    // القناة بتفشل: التبويب الحالي بس هو اللي هيعرف.
  } finally {
    source?.close();
  }
}

/**
 * بيسجّل مستمع للتغير وبيرجّع دالة لإلغاء التسجيل.
 *
 * @param listener الدالة اللي بتتنى التغير
 * @returns دالة الإلغاء
 */
export function onPushRecordChanged(listener: Listener): () => void {
  listeners.add(listener);
  const source = channel();
  if (source !== null) source.onmessage = () => listener();
  return () => {
    listeners.delete(listener);
    source?.close();
  };
}
