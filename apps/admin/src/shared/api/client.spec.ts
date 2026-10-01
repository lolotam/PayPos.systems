import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApiClient } from './client';
import { clearSelection, writeSelection } from './selection-cookie';

const COMPANY_ID = '01923f66-3d2b-7c00-8000-000000000001';

describe('createApiClient', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clearSelection();
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({ companies: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  afterEach(() => {
    clearSelection();
    fetchSpy.mockRestore();
  });

  it('attaches x-company-id header when a company is selected', async () => {
    writeSelection({ companyId: COMPANY_ID });
    const client = createApiClient();

    await client.GET('/v1/me/workspaces');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [input, init] = fetchSpy.mock.calls[0] as [RequestInfo | URL, RequestInit | undefined];
    const req = input instanceof Request ? input : new Request(input, init);

    expect(req.headers.get('x-company-id')).toBe(COMPANY_ID);
  });

  it('does not carry x-company-id header when no company is selected', async () => {
    const client = createApiClient();

    await client.GET('/v1/me/workspaces');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [input, init] = fetchSpy.mock.calls[0] as [RequestInfo | URL, RequestInit | undefined];
    const req = input instanceof Request ? input : new Request(input, init);

    expect(req.headers.get('x-company-id')).toBeNull();
  });

  it('sends credentials include and targets the NEXT_PUBLIC_API_URL origin', async () => {
    const client = createApiClient();

    await client.GET('/v1/me/workspaces');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [input, init] = fetchSpy.mock.calls[0] as [RequestInfo | URL, RequestInit | undefined];
    const req = input instanceof Request ? input : new Request(input, init);

    expect(req.url).toBe('http://127.0.0.1:3000/v1/me/workspaces');
    expect(req.credentials).toBe('include');
  });
});
