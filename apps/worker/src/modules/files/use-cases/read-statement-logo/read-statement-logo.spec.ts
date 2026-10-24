import { expect, it, vi } from 'vitest';

import { StatementLogoUnavailable, type StatementLogoRequest } from '../../domain/statement-logo.ts';
import type { StatementLogoBytes, StatementLogoStore } from '../../ports/statement-logo.port.ts';
import { ReadStatementLogo } from './read-statement-logo.ts';

const request: StatementLogoRequest = {
  businessId: 'business',
  fileId: 'file',
  requesterUserId: 'requester',
  renderId: 'render',
};

const at = new Date('2026-10-21T00:00:00Z');

function setup(bytes: StatementLogoBytes | null) {
  const store: StatementLogoStore = {
    record: vi.fn(async () => ({ storageKey: 'key', contentType: 'image/png' as const })),
  };
  const clock = { now: () => at };
  return { store, bytes, clock, useCase: new ReadStatementLogo(store, bytes, clock) };
}

function reader(): StatementLogoBytes {
  return { read: vi.fn(async () => ({ content_type: 'image/png' as const, bytes: new Uint8Array(4) })) };
}

it('refuses before any transaction when this worker has no storage', async () => {
  const h = setup(null);
  await expect(h.useCase.execute('company', request)).rejects.toMatchObject({
    code: 'STORAGE_UNAVAILABLE',
  });
  expect(h.store.record).not.toHaveBeenCalled();
});

it('refuses an aborted attempt before the file is even looked up', async () => {
  const h = setup(reader());
  const controller = new AbortController();
  controller.abort();
  await expect(h.useCase.execute('company', request, controller.signal)).rejects.toMatchObject({
    code: 'ABORTED',
  });
  expect(h.store.record).not.toHaveBeenCalled();
});

it('returns nothing and never reads the bytes when the file no longer qualifies', async () => {
  const bytes = reader();
  const h = setup(bytes);
  vi.mocked(h.store.record).mockResolvedValueOnce(null);
  await expect(h.useCase.execute('company', request)).resolves.toBeNull();
  expect(bytes.read).not.toHaveBeenCalled();
});

it('records the access once, then reads the file that was recorded', async () => {
  const bytes = reader();
  const h = setup(bytes);
  const controller = new AbortController();
  const result = await h.useCase.execute('company', request, controller.signal);
  expect(h.store.record).toHaveBeenCalledWith('company', request, at);
  expect(bytes.read).toHaveBeenCalledWith(
    { storageKey: 'key', contentType: 'image/png' },
    controller.signal,
  );
  expect(result).toEqual({ content_type: 'image/png', bytes: new Uint8Array(4) });
});

it('propagates a storage failure so the job attempt fails', async () => {
  const bytes = reader();
  const h = setup(bytes);
  vi.mocked(bytes.read).mockRejectedValueOnce(new StatementLogoUnavailable('READ_TIMEOUT'));
  await expect(h.useCase.execute('company', request)).rejects.toMatchObject({
    code: 'READ_TIMEOUT',
  });
});
