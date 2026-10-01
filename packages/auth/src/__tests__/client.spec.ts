import { describe, expect, it, vi } from 'vitest';

const mockCreateAuthClient = vi.fn();

vi.mock('better-auth/client', () => ({
  createAuthClient: (options: unknown) => mockCreateAuthClient(options),
}));

import { createPospayAuthClient } from '../client.ts';

describe('createPospayAuthClient', () => {
  it('configures the Better Auth client with basePath /v1/auth, credentials include and two-factor plugin', () => {
    const url = 'https://api.example.com';
    createPospayAuthClient(url);

    expect(mockCreateAuthClient).toHaveBeenCalledOnce();
    const [options] = mockCreateAuthClient.mock.calls[0] as [{
      baseURL: string;
      basePath: string;
      fetchOptions: { credentials: string };
      plugins: readonly { id: string }[];
    }];

    expect(options.baseURL).toBe(url);
    expect(options.basePath).toBe('/v1/auth');
    expect(options.fetchOptions).toEqual({ credentials: 'include' });
    expect(options.plugins).toHaveLength(1);
    expect(options.plugins[0]?.id).toBe('two-factor');
  });
});
