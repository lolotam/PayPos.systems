import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { bootDevice } from './boot-device';

const mockGet = vi.fn();

vi.mock('../model/device-db', () => ({
  CURRENT_DEVICE: 'current',
  deviceDb: { credentials: { get: (...args: unknown[]) => mockGet(...args) } },
}));

// Without Web Locks two tabs could claim the same registration and one refusal could delete the other's token,
// so the device refuses to pair at all and says why.
describe('a browser without Web Locks', () => {
  const locks = Object.getOwnPropertyDescriptor(globalThis.navigator, 'locks');

  afterEach(() => {
    if (locks !== undefined) Object.defineProperty(globalThis.navigator, 'locks', locks);
  });

  it('gets the unsupported screen and never reads or claims the credential', async () => {
    Object.defineProperty(globalThis.navigator, 'locks', { value: undefined, configurable: true });
    await expect(bootDevice(new QueryClient())).resolves.toEqual({ kind: 'unsupported' });
    expect(mockGet).not.toHaveBeenCalled();
  });
});
