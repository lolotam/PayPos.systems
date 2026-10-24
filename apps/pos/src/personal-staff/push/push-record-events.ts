// إشعار داخل التبويب: السجل المحلي بيتغيّر من أماكن مختلفة (فحص التوقيع، التشغيل، الإيقاف،
// التدوير) والزر لازم يقرأ السجل الجديد. الملف ده مش في `push-record-idb.ts` عشان الـ
// service worker بيستورد الملف ده ومش هيقدر يشغّل إشعار في صفحة (ADR-0052 §7).

type Listener = () => void;

const listeners = new Set<Listener>();

/** بيقول لكل المستمعين إن السجل المحلي اتغيّر. */
export function notifyPushRecordChanged(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // مستمع فاشل ما بيمنعش الباقي من يقرأ السجل.
    }
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
  return () => {
    listeners.delete(listener);
  };
}
