import { expect, it } from 'vitest';
import { PackageCommitError } from '../domain/package-import-commit.ts';
import {
  CommitPackageImport,
  PackageCommitRetryError,
} from '../use-cases/commit-package-import/commit-package-import.ts';
import type { PackageCommitTransactions } from '../ports/package-import-commit.port.ts';

it.each([false, true])('redacts SQL failures, including finalization=%s', async (finalizing) => {
  const raw = new Error('synthetic private SQL params: package name, external_ref, 10.001', {
    cause: new Error('synthetic query parameters'),
  });
  const storage: PackageCommitTransactions = {
    run: async () => {
      throw finalizing ? new PackageCommitError('IMPORT_PREVIEW_EXPIRED') : raw;
    },
    fail: async () => {
      throw raw;
    },
  };
  const worker = new CommitPackageImport(storage, { now: () => new Date('2026-11-06T10:00:00Z') });
  const failure = await worker.execute('company', 'preview').catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(PackageCommitRetryError);
  expect(failure).toMatchObject({
    message: 'PACKAGE_IMPORT_COMMIT_RETRY',
    failureCode: finalizing ? 'IMPORT_PREVIEW_EXPIRED' : undefined,
  });
  expect(failure).not.toHaveProperty('cause');
  expect(JSON.stringify(failure)).not.toMatch(/synthetic|SQL|external_ref|10\.001/);
  expect(String(failure)).not.toContain(raw.message);
});
