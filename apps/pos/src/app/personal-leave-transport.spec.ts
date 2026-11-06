import { afterEach, expect, it, vi } from 'vitest';
import { personalCalls } from '@/personal-staff/api/personal-calls';
import { leaveCalls } from '@/my-leave/api/leave-calls';

const { nativeRequest } = vi.hoisted(() => ({ nativeRequest: vi.fn() }));
vi.mock('@capacitor/core', () => ({ CapacitorHttp: { request: nativeRequest } }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  nativeRequest.mockReset();
});

it('keeps personal sign-in, probe, leave and sign-out in the same native credential transport', async () => {
  vi.stubEnv('VITE_NATIVE', '1');
  vi.stubGlobal('Capacitor', { getPlatform: () => 'ios' });
  vi.stubGlobal('fetch', () => {
    throw new Error('Unexpected WebView request');
  });
  let signedIn = false;
  const session = {
    company_id: 'company',
    business_id: 'business',
    user_id: 'employee',
    employee_id: 'employee',
    expires_at: '2026-12-01T00:00:00Z',
  };
  nativeRequest.mockImplementation(
    async (request: { url: string; headers: Record<string, string> }) => {
      expect(request.headers['Authorization']).toBeUndefined();
      expect(request.headers['Origin']).toBe('capacitor://localhost');
      const path = new URL(request.url).pathname;
      if (path.endsWith('/verify')) signedIn = true;
      if (path.endsWith('/sign-out')) {
        signedIn = false;
        return answer({ status: 'SIGNED_OUT' });
      }
      if (!signedIn) return answer({ code: 'UNAUTHENTICATED' }, 401);
      return answer(
        path.endsWith('/branches')
          ? { items: [{ id: 'branch', name_ar: null, name_en: 'Branch', timezone: 'Asia/Kuwait' }] }
          : session,
      );
    },
  );
  expect(await personalCalls.session()).toBeNull();
  expect(
    await personalCalls.verify({
      company_id: 'company',
      business_id: 'business',
      challenge_id: 'challenge',
      code: '123456',
    }),
  ).toEqual(session);
  expect(await personalCalls.session()).toEqual(session);
  expect((await leaveCalls.branches(new AbortController().signal)).items[0]?.timezone).toBe(
    'Asia/Kuwait',
  );
  await personalCalls.signOut();
  expect(await personalCalls.session()).toBeNull();
  await expect(leaveCalls.branches(new AbortController().signal)).rejects.toMatchObject({
    status: 401,
  });
});

function answer(data: unknown, status = 200) {
  return { status, data, headers: { 'Content-Type': 'application/json' } };
}
