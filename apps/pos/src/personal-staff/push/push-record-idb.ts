import type { PushRecord, PushRecordStore } from './push-record';

// داتابيز مستقلة عن داتابيز التطبيق: السجل ده بيشتغل مع التطبيق ومع الـ service worker،
// ومالهوش علاقة بمسح الكاش الخاص اللي بيعمله مسار الدخول الشخصي (ADR-0027، ADR-0052 §7).
const DATABASE_NAME = 'pospay-push';
const STORE_NAME = 'record';
const RECORD_KEY = 'current';
const DATABASE_VERSION = 1;

function unavailable(): Error {
  return new Error('PUSH_STORE_UNAVAILABLE');
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(unavailable());
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? unavailable());
    request.onblocked = () => reject(unavailable());
  });
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode);
        const request = action(transaction.objectStore(STORE_NAME));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? unavailable());
        transaction.oncomplete = () => database.close();
        transaction.onabort = () => {
          database.close();
          reject(transaction.error ?? unavailable());
        };
      }),
  );
}

/** سجل الإشعارات المحلي على IndexedDB: داتابيز واحدة ومخزن واحد ومفتاح واحد ثابت. */
export const pushRecordStore: PushRecordStore = {
  read: async () => {
    const stored = await runTransaction<PushRecord | undefined>('readonly', (store) =>
      store.get(RECORD_KEY),
    );
    return stored ?? null;
  },
  write: async (record: PushRecord) => {
    await runTransaction('readwrite', (store) => store.put(record, RECORD_KEY));
  },
  remove: async () => {
    await runTransaction('readwrite', (store) => store.delete(RECORD_KEY));
  },
};
