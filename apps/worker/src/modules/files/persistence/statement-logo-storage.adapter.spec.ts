import { afterEach, expect, it, vi } from 'vitest';
import {
  FileValidationError,
  StorageError,
  StorageObjectMissingError,
  type ObjectStorage,
} from '@pospay/storage';

import { STATEMENT_LOGO_LIMITS, StatementLogoUnavailable } from '../domain/statement-logo.ts';
import { pngImage, pngSize } from '../__tests__/png-image.ts';
import { statementLogoStorage } from './statement-logo-storage.adapter.ts';

const file = { storageKey: 'company/business/verified/file', contentType: 'image/png' } as const;

function fakeStorage(
  read: (key: string, maxBytes: number, signal?: AbortSignal) => Promise<Uint8Array>,
): ObjectStorage {
  return {
    presignUpload: vi.fn(async () => 'https://storage.test/upload'),
    presignDownload: vi.fn(async () => 'https://storage.test/download'),
    read: vi.fn(read),
    put: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    close: vi.fn(),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

it('fits the stored PNG to the statement limits', async () => {
  const storage = fakeStorage(async () => pngImage(1200, 600));
  const result = await statementLogoStorage(storage).read(file);
  expect(result?.content_type).toBe('image/png');
  expect(pngSize(result?.bytes ?? new Uint8Array())).toEqual({ width: 512, height: 256 });
});

it('treats a missing object as no logo at all', async () => {
  const storage = fakeStorage(async () => {
    throw new StorageObjectMissingError();
  });
  await expect(statementLogoStorage(storage).read(file)).resolves.toBeNull();
});

it('fails the attempt when the storage itself is unavailable', async () => {
  const storage = fakeStorage(async () => {
    throw new StorageError();
  });
  const failure = await statementLogoStorage(storage)
    .read(file)
    .catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(StatementLogoUnavailable);
  expect((failure as StatementLogoUnavailable).code).toBe('STORAGE_UNAVAILABLE');
});

it('never lets a provider message or a key escape to the caller', async () => {
  const storage = fakeStorage(async () => {
    throw new Error('key acme/secret/path');
  });
  const failure = await statementLogoStorage(storage)
    .read(file)
    .catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(StatementLogoUnavailable);
  expect((failure as StatementLogoUnavailable).code).toBe('STORAGE_UNAVAILABLE');
  expect((failure as Error).message).not.toContain('acme/secret/path');
});

it('fails the attempt when the read outlives the statement timeout', async () => {
  vi.useFakeTimers();
  const storage = fakeStorage(() => new Promise<Uint8Array>(() => undefined));
  const pending = statementLogoStorage(storage).read(file);
  const assertion = expect(pending).rejects.toMatchObject({ code: 'READ_TIMEOUT' });
  await vi.advanceTimersByTimeAsync(STATEMENT_LOGO_LIMITS.readTimeoutMs);
  await assertion;
});

it('fails the attempt when the render is aborted while the read is open', async () => {
  const controller = new AbortController();
  const removed = vi.spyOn(controller.signal, 'removeEventListener');
  const storage = fakeStorage(() => new Promise<Uint8Array>(() => undefined));
  const pending = statementLogoStorage(storage).read(file, controller.signal);
  const assertion = expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
  controller.abort();
  await assertion;
  expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
});

it('refuses an aborted render before it touches the storage', async () => {
  const controller = new AbortController();
  controller.abort();
  const storage = fakeStorage(async () => pngImage(1200, 600));
  await expect(statementLogoStorage(storage).read(file, controller.signal)).rejects.toMatchObject({
    code: 'ABORTED',
  });
  expect(storage.read).not.toHaveBeenCalled();
});

it('cancels the storage request when the read deadline fires', async () => {
  vi.useFakeTimers();
  let handed: AbortSignal | undefined;
  const storage = fakeStorage(async (_key, _maxBytes, signal) => {
    handed = signal;
    return new Promise<Uint8Array>(() => undefined);
  });
  const pending = statementLogoStorage(storage).read(file);
  const assertion = expect(pending).rejects.toMatchObject({ code: 'READ_TIMEOUT' });
  await vi.advanceTimersByTimeAsync(STATEMENT_LOGO_LIMITS.readTimeoutMs);
  await assertion;
  expect(handed?.aborted).toBe(true);
});

it('cancels the storage request when the caller aborts the render', async () => {
  const controller = new AbortController();
  let handed: AbortSignal | undefined;
  const storage = fakeStorage(async (_key, _maxBytes, signal) => {
    handed = signal;
    return new Promise<Uint8Array>(() => undefined);
  });
  const pending = statementLogoStorage(storage).read(file, controller.signal);
  const assertion = expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
  controller.abort();
  await assertion;
  expect(handed?.aborted).toBe(true);
});

it('keeps the aborted render apart from the read timeout', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const timedOut = fakeStorage(() => new Promise<Uint8Array>(() => undefined));
  const pendingTimeout = statementLogoStorage(timedOut).read(file);
  const timeoutAssertion = expect(pendingTimeout).rejects.toMatchObject({ code: 'READ_TIMEOUT' });
  await vi.advanceTimersByTimeAsync(STATEMENT_LOGO_LIMITS.readTimeoutMs);
  await timeoutAssertion;
  const aborted = fakeStorage(() => new Promise<Uint8Array>(() => undefined));
  const pendingAbort = statementLogoStorage(aborted).read(file, controller.signal);
  const abortAssertion = expect(pendingAbort).rejects.toMatchObject({ code: 'ABORTED' });
  controller.abort();
  await abortAssertion;
});

it('rethrows a broken stored logo so the attempt fails visibly', async () => {
  const storage = fakeStorage(async () => Buffer.from('not an image'));
  const failure = await statementLogoStorage(storage)
    .read(file)
    .catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(FileValidationError);
  expect((failure as FileValidationError).code).toBe('FILE_CONTENT_INVALID');
});
