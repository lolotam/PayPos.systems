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
 * بيكتب السجل بس لو جيله ورقم مراجعته وتوكنه زي ما هما، والقراءة والكتابة في transaction واحد.
 * التوكن بيقفل الاستبدال العادي اللي مش بيزود المراجعة؛ ولو السجل المحفوظ معلّق، السجل الجديد
 * يفضل معلّق إلا لو الطلب قال صريح إن التعليق يتشال.
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
        let written: boolean | undefined;
        generationRequest.onsuccess = () => {
          if (readGeneration(generationRequest.result) !== expected) return;
          const recordRequest = store.get(RECORD_KEY) as IDBRequest<PushRecord | undefined>;
          recordRequest.onsuccess = () => {
            const stored = recordRequest.result;
            const revision = stored?.revision ?? 0;
            if (options.expectRevision !== undefined && revision !== options.expectRevision) return;
            if (
              options.expectToken !== undefined &&
              (stored?.token ?? null) !== options.expectToken
            ) {
              return;
            }
            const clear = options.clearSuspension === true;
            const suspended = stored?.suspended === true && !clear;
            store.put(suspended ? { ...record, suspended: true } : record, RECORD_KEY);
            written = true;
          };
        };
        transaction.oncomplete = () => {
          database.close();
          resolve(written === true);
        };
        transaction.onabort = () => {
          database.close();
          reject(transaction.error ?? unavailable());
        };
      }),
  );
}

/** بيمسح السجل بس لو لسه هو نفسه: تسجيل موظفة تانية ما يضيعش أثناء تنظيف قديم. */
function removeIfMatches(expected: { token: string | null; revision: number }): Promise<boolean> {
  return openDatabase().then(
    (database) =>
      new Promise<boolean>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(RECORD_KEY) as IDBRequest<PushRecord | undefined>;
        let removed = false;
        request.onsuccess = () => {
          const stored = request.result;
          if (
            stored === undefined ||
            stored.token !== expected.token ||
            (stored.revision ?? 0) !== expected.revision
          ) {
            return;
          }
          store.delete(RECORD_KEY);
          removed = true;
        };
        transaction.oncomplete = () => {
          database.close();
          resolve(removed);
        };
        transaction.onabort = () => {
          database.close();
          reject(transaction.error ?? unavailable());
        };
      }),
  );
}

/**
 * بيعلّق النسخة المخزنة جوه نفس الـ transaction عشان لقطة قديمة ما ترجعش توكن اتبدل
 * أو سجل اتمسح، وبيرجع المراجعة الجديدة عشان مقارنة قديمة ما تمسحش تعليقًا أحدث.
 */
function suspendRecord(): Promise<number> {
  return openDatabase().then(
    (database) =>
      new Promise<number>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(RECORD_KEY) as IDBRequest<PushRecord | undefined>;
        let revision = 0;
        request.onsuccess = () => {
          const stored = request.result;
          if (stored === undefined) return;
          revision = (stored.revision ?? 0) + 1;
          store.put({ ...stored, suspended: true, revision }, RECORD_KEY);
        };
        transaction.oncomplete = () => {
          database.close();
          resolve(revision);
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
    if (stored === undefined) return null;
    // سجل قديم من غير رقم مراجعة: بنعتبره صفر (ADR-0052 §7).
    return { ...stored, revision: stored.revision ?? 0 };
  },
  write: async (record: PushRecord) => {
    await runTransaction('readwrite', (store) => store.put(record, RECORD_KEY));
  },
  remove: async () => {
    await runTransaction('readwrite', (store) => store.delete(RECORD_KEY));
  },
  removeIfMatches: async (expected: { token: string | null; revision: number }) =>
    removeIfMatches(expected),
  suspend: async () => suspendRecord(),
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
