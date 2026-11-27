import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { bootDevice } from './boot-device';

const mockGet = vi.fn();
const mockProbe = vi.fn();

vi.mock('../model/device-db', () => ({
  CURRENT_DEVICE: 'current',
  deviceDb: { credentials: { get: (...args: unknown[]) => mockGet(...args) } },
}));
vi.mock('./probe', () => ({
  probeDevice: (...args: unknown[]) => mockProbe(...args),
}));

// Without Web Locks two tabs could claim the same registration and one refusal could delete the other's token,
// so the device refuses to pair at all and says why.
describe('a browser without Web Locks', () => {
  const locks = Object.getOwnPropertyDescriptor(globalThis.navigator, 'locks');

  afterEach(() => {
    vi.clearAllMocks();
    if (locks !== undefined) Object.defineProperty(globalThis.navigator, 'locks', locks);
  });

  it.each([
    { name: 'no stored credentials', row: undefined, canStartOver: true },
    {
      name: 'a stored device token',
      row: { device_token: 'synthetic-token', claim_secret: null },
      canStartOver: false,
    },
    {
      name: 'a stored claim secret',
      row: { device_token: null, claim_secret: 'synthetic-secret' },
      canStartOver: false,
    },
  ])(
    'reports $name as unsupported and never calls the device API',
    async ({ row, canStartOver }) => {
      Object.defineProperty(globalThis.navigator, 'locks', {
        value: undefined,
        configurable: true,
      });
      mockGet.mockResolvedValue(row);

      await expect(bootDevice(new QueryClient())).resolves.toEqual({
        kind: 'unsupported',
        canStartOver,
      });
      expect(mockProbe).not.toHaveBeenCalled();
    },
  );

  it('fails closed when the stored credentials cannot be read', async () => {
    Object.defineProperty(globalThis.navigator, 'locks', { value: undefined, configurable: true });
    mockGet.mockRejectedValue(new Error('SYNTHETIC_READ_FAILURE'));

    await expect(bootDevice(new QueryClient())).resolves.toEqual({
      kind: 'unsupported',
      canStartOver: false,
    });
    expect(mockProbe).not.toHaveBeenCalled();
  });
});
