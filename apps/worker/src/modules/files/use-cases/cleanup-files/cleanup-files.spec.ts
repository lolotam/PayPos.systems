import { expect, it, vi } from 'vitest';

import type { RetentionRepository } from '../../ports/retention.port.ts';
import { CleanupFiles } from './cleanup-files.ts';

it('skips the claim when storage is absent', async () => {
  const claim = vi.fn();
  const useCase = new CleanupFiles(
    { claim } as unknown as RetentionRepository,
    null,
    { newId: () => '01990000-0000-7000-8000-000000000001' },
    { now: () => new Date('2026-10-10T12:00:00Z') },
  );
  expect(await useCase.execute('company', 'retired')).toBe(0);
  expect(await useCase.execute('company', 'abandoned')).toBe(0);
  expect(claim).not.toHaveBeenCalled();
});
