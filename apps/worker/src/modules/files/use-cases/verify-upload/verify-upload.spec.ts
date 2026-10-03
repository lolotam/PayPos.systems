import { expect, it, vi } from 'vitest';
import { VerifyUpload } from './verify-upload.ts';
import { VerificationRejected } from '../../domain/verification.ts';
import type { VerificationRepository, VerificationStorage } from '../../ports/verification.port.ts';

function setup() {
  const file = {
    id: 'file',
    businessId: 'business',
    stagingKey: 'staging',
    type: 'image/png',
    size: 10,
  };
  const repository: VerificationRepository = {
    claim: vi.fn(async () => file),
    reserve: vi.fn(async () => true),
    complete: vi.fn(async () => true),
    reject: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
  };
  const storage: VerificationStorage = {
    inspect: vi.fn(async () => ({ bytes: new Uint8Array(8), type: 'image/png', size: 8 })),
    candidateKey: () => 'verified',
    write: vi.fn(async () => undefined),
  };
  const artifacts = { execute: vi.fn(async () => 1) };
  const useCase = new VerifyUpload(
    repository,
    storage,
    { newId: () => 'attempt' },
    { now: () => new Date('2026-10-01T00:00:00Z') },
    artifacts,
  );
  return { repository, storage, useCase, artifacts };
}
it('records candidate ownership before PUT and publishes before durable staging cleanup', async () => {
  const h = setup();
  await h.useCase.execute('company', 'file');
  expect(h.repository.claim).toHaveBeenCalledWith(
    'company',
    'file',
    'attempt',
    new Date('2026-10-01T00:00:00Z'),
    new Date('2026-10-01T00:02:00Z'),
  );
  expect(h.repository.complete).toHaveBeenCalledWith(
    'company',
    'file',
    'attempt',
    {
      key: 'verified',
      type: 'image/png',
      size: 8,
    },
    new Date('2026-10-01T00:00:00Z'),
  );
  expect(h.repository.reserve).toHaveBeenCalled();
  expect(vi.mocked(h.repository.reserve).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(h.storage.write).mock.invocationCallOrder[0] ?? 0,
  );
  expect(h.artifacts.execute).toHaveBeenCalledWith('company');
});
it('marks content rejection final, while a transport error releases the lease for retry', async () => {
  const h = setup();
  vi.mocked(h.storage.inspect).mockRejectedValueOnce(new VerificationRejected('FILE_TYPE_INVALID'));
  await h.useCase.execute('company', 'file');
  expect(h.repository.reject).toHaveBeenCalledWith(
    'company',
    'file',
    'attempt',
    'FILE_TYPE_INVALID',
    new Date('2026-10-01T00:00:00Z'),
  );
  expect(h.repository.complete).not.toHaveBeenCalled();
  vi.mocked(h.storage.inspect).mockRejectedValueOnce(new Error('STORAGE_UNAVAILABLE'));
  await expect(h.useCase.execute('company', 'file')).rejects.toThrow('STORAGE_UNAVAILABLE');
  expect(h.repository.release).toHaveBeenCalledWith('company', 'file', 'attempt');
});
it('a superseded lease cannot publish or remove another worker’s staging object', async () => {
  const h = setup();
  vi.mocked(h.repository.complete).mockResolvedValueOnce(false);
  await h.useCase.execute('company', 'file');
  expect(h.artifacts.execute).not.toHaveBeenCalled();
});
it('completed, rejected or unknown tenant objects cause no storage access', async () => {
  const h = setup();
  vi.mocked(h.repository.claim).mockResolvedValueOnce(null);
  await h.useCase.execute('company', 'file');
  expect(h.storage.inspect).not.toHaveBeenCalled();
});

it('a superseded lease never writes without durable ownership', async () => {
  const h = setup();
  vi.mocked(h.repository.reserve).mockResolvedValueOnce(false);
  await h.useCase.execute('company', 'file');
  expect(h.storage.write).not.toHaveBeenCalled();
  expect(h.repository.complete).not.toHaveBeenCalled();
});
it('a publication failure leaves its already owned key recoverable', async () => {
  const h = setup();
  vi.mocked(h.repository.complete).mockRejectedValueOnce(new Error('FILE_VERIFICATION_RETRY'));
  await expect(h.useCase.execute('company', 'file')).rejects.toThrow('FILE_VERIFICATION_RETRY');
  expect(h.storage.write).toHaveBeenCalled();
  expect(h.repository.reserve).toHaveBeenCalled();
  expect(h.repository.release).toHaveBeenCalled();
});
it('deletion errors are retried when replay finds a READY file', async () => {
  const h = setup();
  h.artifacts.execute.mockRejectedValueOnce(new Error('FILE_ARTIFACT_CLEANUP_RETRY'));
  await expect(h.useCase.execute('company', 'file')).rejects.toThrow('FILE_ARTIFACT_CLEANUP_RETRY');
  vi.mocked(h.repository.claim).mockResolvedValueOnce(null);
  await h.useCase.execute('company', 'file');
  expect(h.artifacts.execute).toHaveBeenCalledTimes(2);
  expect(h.storage.write).toHaveBeenCalledTimes(1);
});
