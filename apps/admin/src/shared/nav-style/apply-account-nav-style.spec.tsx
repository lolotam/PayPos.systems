import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearNavStyleCookie } from './nav-style-cookie';
import { SignInStyleProbe } from './sign-in-style-probe.fixture';

const mocks = vi.hoisted(() => ({
  loadPage: vi.fn(),
  announceIdentityChange: vi.fn(),
  signInWithPassword: vi.fn(),
  verifyTotpCode: vi.fn(),
}));
vi.mock('@/session/api/session-calls', () => mocks);
vi.mock('@/shared/browser/load-page', () => ({
  loadPage: mocks.loadPage,
  announceIdentityChange: mocks.announceIdentityChange,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const cookieStyle = () =>
  document.cookie
    .split('; ')
    .find((v) => v.startsWith('pospay_nav_style='))
    ?.split('=')[1];
let atNavigation: string | undefined;
let atAnnouncement: string | undefined;
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// openapi-fetch يلتقط fetch عند أول إنشاء للعميل، فالـ stub الواحد يفوّض لمعالج الاختبار الحالي.
const fetchRequests: Request[] = [];
let respond: (request: Request) => Promise<Response> = () =>
  Promise.reject(new Error('SYNTHETIC_NO_FETCH_HANDLER'));
const stubbedFetch = (input: string | Request): Promise<Response> => {
  const request = input instanceof Request ? input : new Request(input);
  fetchRequests.push(request);
  return respond(request);
};

function answerWith(handler: (request: Request) => Promise<Response>): void {
  respond = handler;
}

/** بطء حقيقي يمر عبر العميل المولّد: إما النقل المعلّق أو رؤوس تصل وجسم يتأخر داخل حد الدقيقتين. */
function installSlowAnswer(mode: 'transport' | 'body'): () => void {
  if (mode === 'transport') {
    let release: (() => void) | undefined;
    answerWith(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(jsonResponse({ navStyle: 'A' }));
        }),
    );
    return () => release?.();
  }
  const encoder = new TextEncoder();
  answerWith(() =>
    Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            setTimeout(() => {
              controller.enqueue(encoder.encode(JSON.stringify({ navStyle: 'A' })));
              controller.close();
            }, 5_000);
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ),
  );
  return () => undefined;
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEXT_PUBLIC_API_URL = 'http://api.test';
  document.cookie = 'pospay_nav_style=B; Path=/';
  atNavigation = 'not navigated';
  atAnnouncement = 'not announced';
  fetchRequests.length = 0;
  mocks.loadPage.mockImplementation(() => {
    atNavigation = cookieStyle();
  });
  mocks.announceIdentityChange.mockImplementation(() => {
    atAnnouncement = cookieStyle();
  });
  mocks.signInWithPassword.mockResolvedValue('done');
  mocks.verifyTotpCode.mockResolvedValue(undefined);
  vi.stubGlobal('fetch', stubbedFetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  clearNavStyleCookie();
  delete process.env.NEXT_PUBLIC_API_URL;
});

/** دخول من المسار الحقيقي حتى بدء الانتقال: رسم ثم ضغط ثم انتظار الـ loadPage الوحيد. */
async function signInAndAwait(kind: 'password' | 'totp'): Promise<void> {
  render(<SignInStyleProbe kind={kind} />);
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => expect(mocks.loadPage).toHaveBeenCalledTimes(1));
}

describe.each(['password', 'totp'] as const)('%s account style before navigation', (kind) => {
  it.each([
    ['style A', { navStyle: 'A' }, 'A'],
    ['no choice', { navStyle: null }, undefined],
    ['an out-of-range value', { navStyle: 'D' }, undefined],
    ['a malformed body', {}, undefined],
  ])('applies %s before one navigation', async (_name, body, expected) => {
    answerWith(() => Promise.resolve(jsonResponse(body)));
    await signInAndAwait(kind);
    expect(atNavigation).toBe(expected);
    expect(mocks.loadPage).toHaveBeenCalledWith('/');
    expect(fetchRequests[0]?.url).toBe('http://api.test/v1/me/preferences');
    expect(fetchRequests[0]?.cache).toBe('no-store');
    expect(mocks.announceIdentityChange.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.loadPage.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });
  it.each(['refusal', 'network'])('clears the previous style after %s', async (failure) => {
    if (failure === 'network') answerWith(() => Promise.reject(new Error('SYNTHETIC_NETWORK')));
    else answerWith(() => Promise.resolve(jsonResponse({}, 401)));
    await signInAndAwait(kind);
    expect(atNavigation).toBeUndefined();
  });
  it('clears the previous cookie before announcing other tabs', async () => {
    answerWith(() => Promise.resolve(jsonResponse({ navStyle: 'A' })));
    await signInAndAwait(kind);
    expect(atAnnouncement).toBeUndefined();
  });
  it.each(['transport', 'body'] as const)(
    'keeps submit disabled through the whole %s deadline and ignores a late answer',
    async (mode) => {
      vi.useFakeTimers();
      const release = installSlowAnswer(mode);
      render(<SignInStyleProbe kind={kind} />);
      fireEvent.click(screen.getByRole('button'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1999);
      });
      expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true);
      expect(mocks.loadPage).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(atNavigation).toBeUndefined();
      expect(mocks.loadPage).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true);
      await act(async () => {
        release();
        await vi.advanceTimersByTimeAsync(6_000);
      });
      expect(cookieStyle()).toBeUndefined();
      expect(mocks.loadPage).toHaveBeenCalledTimes(1);
    },
  );
});
it.each(['totp', 'admin.unexpected'])(
  'does not read on the password outcome %s',
  async (outcome) => {
    answerWith(() => Promise.resolve(jsonResponse({ navStyle: 'A' })));
    mocks.signInWithPassword.mockResolvedValue(outcome);
    render(<SignInStyleProbe kind="password" />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByRole('button').hasAttribute('disabled')).toBe(false));
    expect(cookieStyle()).toBe('B');
    expect(fetchRequests).toHaveLength(0);
    expect(mocks.announceIdentityChange).not.toHaveBeenCalled();
  },
);
it('does not read after a refused second factor', async () => {
  answerWith(() => Promise.resolve(jsonResponse({ navStyle: 'A' })));
  mocks.verifyTotpCode.mockResolvedValue('admin.codeInvalid');
  render(<SignInStyleProbe kind="totp" />);
  fireEvent.click(screen.getByRole('button'));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'admin.codeInvalid');
  expect(cookieStyle()).toBe('B');
  expect(fetchRequests).toHaveLength(0);
});
