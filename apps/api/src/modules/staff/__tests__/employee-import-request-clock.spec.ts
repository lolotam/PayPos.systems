import { expect, it, vi } from 'vitest';
import type {
  EmployeeImportTransactions,
  StoredImportPreview,
} from '../ports/employee-import.port.ts';
import { CommitEmployeeImportUseCase } from '../use-cases/commit-employee-import/commit-employee-import.usecase.ts';

const expiresAt = '2026-10-06T10:00:00.000Z';
const preview: StoredImportPreview = {
  id: 'preview',
  business_id: 'business',
  created_by: 'user',
  status: 'ready',
  committed_at: null,
  expires_at: expiresAt,
  rows: [],
  errors: [],
};

it('reads the acceptance clock once and stores the instant used for expiry', async () => {
  const before = new Date('2026-10-06T09:59:59.999Z');
  const now = vi.fn().mockReturnValueOnce(before).mockReturnValue(new Date(expiresAt));
  const request = vi.fn();
  const transactions: EmployeeImportTransactions = {
    runPreview: vi.fn(),
    runCommit: async (_, work) =>
      work({
        authorize: async () => true,
        load: async () => preview,
        request,
      }),
  };
  const useCase = new CommitEmployeeImportUseCase(transactions, { newId: () => 'id' }, { now });
  await expect(
    useCase.execute({
      companyId: 'company',
      businessId: 'business',
      userId: 'user',
      previewId: preview.id,
      key: 'key',
      fingerprint: 'fingerprint',
    }),
  ).resolves.toEqual({ preview_id: preview.id });
  expect(request).toHaveBeenCalledWith(preview.id, before.toISOString());
  expect(now).toHaveBeenCalledTimes(1);
});
