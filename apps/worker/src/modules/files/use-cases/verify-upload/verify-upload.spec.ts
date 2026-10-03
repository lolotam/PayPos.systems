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
    complete: vi.fn(async () => true),
    reject: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
  };
  const storage: VerificationStorage = {
    verify: vi.fn(async () => ({ key: 'verified', type: 'image/png', size: 8 })),
    removeStaging: vi.fn(async () => undefined),
  };
  const useCase = new VerifyUpload(
    repository,
    storage,
    { newId: () => 'attempt' },
    { now: () => new Date('2026-10-01T00:00:00Z') },
  );
  return { repository, storage, useCase };
}
it('publishes only after verification and then removes staging', async () => {
  const h = setup();
  await h.useCase.execute('company', 'file');
  expect(h.repository.claim).toHaveBeenCalledWith(
    'company',
    'file',
    'attempt',
    new Date('2026-10-01T00:00:00Z'),
    new Date('2026-10-01T00:02:00Z'),
  );
  expect(h.repository.complete).toHaveBeenCalledWith('company', 'file', 'attempt', {
    key: 'verified',
    type: 'image/png',
    size: 8,
  });
  expect(h.storage.removeStaging).toHaveBeenCalledWith('staging');
});
it('marks content rejection final, while a transport error releases the lease for retry', async () => {
  const h = setup();
  vi.mocked(h.storage.verify).mockRejectedValueOnce(new VerificationRejected('FILE_TYPE_INVALID'));
  await h.useCase.execute('company', 'file');
  expect(h.repository.reject).toHaveBeenCalledWith(
    'company',
    'file',
    'attempt',
    'FILE_TYPE_INVALID',
    new Date('2026-10-01T00:00:00Z'),
  );
  expect(h.repository.complete).not.toHaveBeenCalled();
  vi.mocked(h.storage.verify).mockRejectedValueOnce(new Error('STORAGE_UNAVAILABLE'));
  await expect(h.useCase.execute('company', 'file')).rejects.toThrow('STORAGE_UNAVAILABLE');
  expect(h.repository.release).toHaveBeenCalledWith('company', 'file', 'attempt');
});
it('a superseded lease cannot publish or remove another worker’s staging object', async () => {
  const h = setup();
  vi.mocked(h.repository.complete).mockResolvedValueOnce(false);
  await h.useCase.execute('company', 'file');
  expect(h.storage.removeStaging).not.toHaveBeenCalled();
});
it('completed, rejected or unknown tenant objects cause no storage access', async () => {
  const h = setup();
  vi.mocked(h.repository.claim).mockResolvedValueOnce(null);
  await h.useCase.execute('company', 'file');
  expect(h.storage.verify).not.toHaveBeenCalled();
});
