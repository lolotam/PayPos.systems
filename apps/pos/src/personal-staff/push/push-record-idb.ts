import type { PushRecord, PushRecordStore, PushWriteOptions } from './push-record';

// داتابيز مستقلة عن داتابيز التطبيق: السجل ده بيشتغل مع التطبيق ومع الـ service worker،
// ومالهوش علاقة بمسح الكاش الخاص اللي بيعمله مسار الدخول الشخصي (ADR-0027، ADR-0052 §7).
// جيل السجل متخزن هنا كمان: كل التبويبات بتشارك نفس IndexedDB، فالتسجيل في تبويب تاني
// لازم يوقف الكتابة في التبويب ده (ADR-0052 §7).
const DATABASE_NAME = 'pospay-push';
const STORE_NAME = 'record';
const RECORD_KEY = 'current';
const GENERATION_KEY = 'generation';
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
        let result: T | undefined;
        request.onsuccess = () => {
          result = request.result;
        };
        // النتيجة بتتأكد بس لما الـ transaction يبقى committed؛ فشل الـ commit (الحصة مثلاً)
        // لازم يبقى رفض مش نجاح (ADR-0052 §7).
        transaction.oncomplete = () => {
          database.close();
          resolve(result as T);
        };
        transaction.onabort = () => {
          database.close();
          reject(transaction.error ?? unavailable());
        };
      }),
  );
}

function readGeneration(result: number | undefined): number {
  return typeof result === 'number' ? result : 0;
}

/** بيكسر جيل السجل: القراءة والزيادة والكتابة في transaction واحد، فالتسجيلات ما تتزاحمش. */
function bumpGeneration(): Promise<number> {
  return openDatabase().then(
    (database) =>
      new Promise<number>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(GENERATION_KEY) as IDBRequest<number | undefined>;
        let next = 0;
        request.onsuccess = () => {
          next = readGeneration(request.result) + 1;
          store.put(next, GENERATION_KEY);
        };
        transaction.oncomplete = () => {
          database.close();
          resolve(next);
        };
        transaction.onabort = () => {
          database.close();
          reject(transaction.error ?? unavailable());
        };
      }),
  );
}

/**
 * بيكتب السجل بس لو جيله زي ما هو، والقراءة والكتابة في transaction واحد.
 * ولو السجل المحفوظ معلّق، السجل الجديد يفضل معلّق إلا لو الطلب قال صريح إن التعليق يتشال
 * والسجل المحفوظ هو نفسه اللي الطلب بدأ منه (التوكن المتوقع).
 */
function writeIfGeneration(
  record: PushRecord,
  expected: number,
  options: PushWriteOptions,
): Promise<boolean> {
  return openDatabase().then(
    (database) =>
      new Promise<boolean>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const generationRequest = store.get(GENERATION_KEY) as IDBRequest<number | undefined>;
        let written = false;
        generationRequest.onsuccess = () => {
          if (readGeneration(generationRequest.result) !== expected) return;
          const recordRequest = store.get(RECORD_KEY) as IDBRequest<PushRecord | undefined>;
          recordRequest.onsuccess = () => {
            const stored = recordRequest.result;
            const sameRecord =
              options.expectToken === undefined
                ? true
                : options.expectToken === null
                  ? stored === undefined
                  : stored?.token === options.expectToken;
            const clear = options.clearSuspension === true && sameRecord;
            const suspended = stored?.suspended === true && !clear;
            store.put(suspended ? { ...record, suspended: true } : record, RECORD_KEY);
            written = true;
          };
        };
        transaction.oncomplete = () => {
          database.close();
          resolve(written);
        };
        transaction.onabort = () => {
          database.close();
          reject(transaction.error ?? unavailable());
        };
      }),
  );
}

/** سجل الإشعارات المحلي على IndexedDB: داتابيز واحدة ومخزن واحد ومفتاحين ثابتين. */
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
  generation: async () => {
    const stored = await runTransaction<number | undefined>('readonly', (store) =>
      store.get(GENERATION_KEY),
    );
    return readGeneration(stored);
  },
  bumpGeneration: async () => bumpGeneration(),
  writeIfGeneration: async (record: PushRecord, expected: number, options?: PushWriteOptions) =>
    writeIfGeneration(record, expected, options ?? {}),
};
