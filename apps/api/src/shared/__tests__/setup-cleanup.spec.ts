import { expect, it } from 'vitest';
import { cleanupStack } from '../../../test/cleanup-stack.ts';

it('setup failure releases acquired resources before the clone, even if one close fails', async () => {
  const cleanup = cleanupStack();
  const released: string[] = [];
  for (const name of ['clone', 'owner', 'auth', 'app']) {
    cleanup.own(name, async (resource) => {
      released.push(resource);
      if (resource === 'auth') throw new Error('SYNTHETIC_CLOSE_FAILURE');
    });
  }
  await expect(cleanup.close()).rejects.toThrow('Test resources could not close');
  expect(released).toEqual(['app', 'auth', 'owner', 'clone']);
  await expect(cleanup.close()).rejects.toThrow('Test resources could not close');
  expect(released).toHaveLength(4);
});

it('cleanup before the first resource was acquired is safe', async () => {
  const cleanup = cleanupStack();
  await expect(cleanup.close()).resolves.toBeUndefined();
});
