import {
  FILE_UPLOAD_POLICY,
  fitImage,
  StorageObjectMissingError,
  type ObjectStorage,
} from '@pospay/storage';

import {
  STATEMENT_LOGO_LIMITS,
  StatementLogoUnavailable,
  type StatementLogoFile,
} from '../domain/statement-logo.ts';
import type { StatementLogoBytes } from '../ports/statement-logo.port.ts';

export function statementLogoStorage(storage: ObjectStorage): StatementLogoBytes {
  return {
    read: async (file: StatementLogoFile, signal?: AbortSignal) => {
      if (signal?.aborted) throw new StatementLogoUnavailable('ABORTED');
      const bytes = await readBytes(storage, file, signal);
      if (bytes === null) return null;
      const fitted = await fitImage(bytes, file.contentType, {
        maxSide: STATEMENT_LOGO_LIMITS.maxSide,
        maxBytes: STATEMENT_LOGO_LIMITS.maxBytes,
      });
      return { content_type: file.contentType, bytes: fitted };
    },
  };
}

// حدّ القراءة من سياسة الملفات؛ نوعا الشعار موجودين فيها دائماً.
function readLimit(contentType: 'image/png' | 'image/jpeg'): number {
  return FILE_UPLOAD_POLICY[contentType] as number;
}

async function readBytes(
  storage: ObjectStorage,
  file: StatementLogoFile,
  signal?: AbortSignal,
): Promise<Uint8Array | null> {
  // مهلة القراءة وإلغاء العَهدة في متحكم واحد: الإلغاء بيوصل للتخزين نفسه، فمفيش تحميل
  // بيفضل شغّال في الخلفية بعد ما المحاولة فشلت، والمحاولة الجاية مش بتتقاطع معاه.
  const controller = new AbortController();
  let stopped: 'ABORTED' | 'READ_TIMEOUT' | undefined;
  const stop = (code: 'ABORTED' | 'READ_TIMEOUT') => {
    if (stopped !== undefined) return;
    stopped = code;
    controller.abort();
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      stop('READ_TIMEOUT');
      reject(new StatementLogoUnavailable('READ_TIMEOUT'));
    }, STATEMENT_LOGO_LIMITS.readTimeoutMs);
  });
  const aborted = new Promise<never>((_, reject) => {
    if (signal === undefined) return;
    onAbort = () => {
      stop('ABORTED');
      reject(new StatementLogoUnavailable('ABORTED'));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([
      storage.read(file.storageKey, readLimit(file.contentType), controller.signal),
      deadline,
      aborted,
    ]);
  } catch (error) {
    // السبب اللي وقف القراءة هو اللي بيحدد النتيجة، مش الخطأ اللي جاي من التخزين.
    if (stopped !== undefined) throw new StatementLogoUnavailable(stopped);
    if (error instanceof StorageObjectMissingError) return null;
    if (error instanceof StatementLogoUnavailable) throw error;
    throw new StatementLogoUnavailable('STORAGE_UNAVAILABLE');
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort !== undefined) signal?.removeEventListener('abort', onAbort);
    controller.abort();
  }
}
