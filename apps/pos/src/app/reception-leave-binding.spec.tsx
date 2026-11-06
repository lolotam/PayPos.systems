import { t } from '@pospay/i18n';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { useDeviceSession } from '@/device/api/use-device-session';
import { LocaleProvider } from '@/shared/locale/locale-context';
import { DeviceBody } from './device-body';

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const stored = vi.hoisted(() => ({ device: 'synthetic-token' }));
vi.mock('@/device/model/device-db', () => ({
  CURRENT_DEVICE: 'current',
  deviceDb: { credentials: { get: async () => ({ device_token: stored.device }) } },
}));
vi.mock('@/shared/api/device-auth', () => ({ currentDeviceToken: async () => stored.device }));
let current = { branch_id: id(5), device_id: id(6) };
let initial = true;
let boots = 0;
let reads = 0;
let writes = 0;
let release: (() => void) | undefined;
let hold = false;
let refuseLeave = false;
let zone = 'Asia/Kuwait';
let name = 'Old branch';
let logged = true;
let user = id(3);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-04T10:00:00Z'));
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {} });
  current = { branch_id: id(5), device_id: id(6) };
  refuseLeave = false;
  initial = true;
  boots = 0;
  reads = 0;
  writes = 0;
  hold = false;
  release = undefined;
  zone = 'Asia/Kuwait';
  name = 'Old branch';
  logged = true;
  user = id(3);
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.stubGlobal('fetch', bindingTransport);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function App() {
  const device = useDeviceSession();
  return <DeviceBody session={device} />;
}
function mount(cache: QueryClient) {
  render(
    <QueryClientProvider client={cache}>
      <LocaleProvider locale="en" setLocale={() => undefined}>
        <App />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

it('rearms binding recovery after a trusted match without looping during a repeated mismatch', async () => {
  const cache = new QueryClient();
  mount(cache);
  await screen.findByRole('button', { name: 'My leave' });
  for (let cycle = 0; cycle < 2; cycle += 1) {
    hold = true;
    release = undefined;
    await act(async () => {
      cache.setQueryData(['staff-session', 0], {
        ...current,
        branch_id: id(7),
        user_id: id(3),
        company_id: id(1),
        business_id: id(2),
        expires_at: '2026-10-04T12:00:00Z',
      });
    });
    await waitFor(() => expect(release).toBeTypeOf('function'));
    expect(screen.queryByRole('button', { name: 'My leave' })).toBeNull();
    expect(boots).toBe(cycle + 2);
    await act(async () => {
      hold = false;
      release?.();
    });
    await screen.findByRole('button', { name: 'My leave' });
    expect(boots).toBe(cycle + 2);
  }
});

it.each(['branch', 'device', 'matching'] as const)(
  '%s pairing gates leave until the displayed device context is refreshed',
  async (change) => {
    const cache = new QueryClient();
    mount(cache);
    await screen.findByText('Old branch');
    await screen.findByRole('button', { name: 'My leave' });
    if (change !== 'matching') {
      refuseLeave = true;
      fireEvent.click(screen.getByRole('button', { name: 'My leave' }));
      await screen.findByRole('button', { name: 'Retry' });
      refuseLeave = false;
    }
    initial = false;
    if (change === 'branch') current = { ...current, branch_id: id(7) };
    if (change === 'device') current = { ...current, device_id: id(8) };
    if (change !== 'matching') {
      hold = true;
      zone = 'America/New_York';
      name = 'New paired branch';
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await waitFor(() => expect(release).toBeTypeOf('function'));
      expect(screen.queryByRole('button', { name: 'My leave' })).toBeNull();
      expect(reads).toBe(1);
      expect(writes).toBe(0);
      await act(async () => {
        hold = false;
        release?.();
      });
      await screen.findByText('New paired branch');
      expect(screen.getByLabelText('Branch time').textContent).toContain('06:00');
    }
    fireEvent.click(await screen.findByRole('button', { name: 'My leave' }));
    await screen.findByLabelText('From date');
    expect(reads).toBeGreaterThan(0);
    expect(writes).toBe(0);
    expect(boots).toBe(change === 'matching' ? 1 : 2);
  },
);

async function signIn(method: 'pin' | 'otp') {
  if (method === 'pin')
    fireEvent.click(screen.getByRole('button', { name: t('en', 'staffLogin.usePin') }));
  fireEvent.change(screen.getByLabelText(t('en', 'staffLogin.phone')), {
    target: { value: '+99900000001' },
  });
  if (method === 'pin') {
    fireEvent.change(screen.getByLabelText(t('en', 'staffLogin.ownPin')), {
      target: { value: '1234' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('en', 'staffLogin.pinSignIn') }));
  } else {
    fireEvent.change(screen.getByLabelText(t('en', 'staffLogin.language')), {
      target: { value: 'en' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('en', 'staffLogin.request') }));
    fireEvent.change(await screen.findByLabelText(t('en', 'staffLogin.code')), {
      target: { value: '000007' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('en', 'staffLogin.verify') }));
  }
  await screen.findByRole('button', { name: 'My leave' });
}

it.each([
  ['pin', 'branch', false],
  ['pin', 'device', false],
  ['otp', 'branch', false],
  ['otp', 'device', false],
  ['pin', 'branch', true],
  ['pin', 'device', true],
  ['otp', 'branch', true],
  ['otp', 'device', true],
] as const)(
  '%s login and operator switch refresh %s binding immediately (BC %s)',
  async (method, change, broadcast) => {
    // Each test owns its channel registry; posting excludes only the sending channel.
    if (broadcast) {
      const channels = new Set<Channel>();
      class Channel {
        onmessage: (() => void) | null = null;
        constructor(readonly name: string) {
          channels.add(this);
        }
        postMessage() {
          for (const peer of channels)
            if (peer !== this && peer.name === this.name)
              queueMicrotask(() => {
                if (channels.has(peer)) peer.onmessage?.();
              });
        }
        close() {
          channels.delete(this);
        }
      }
      vi.stubGlobal('BroadcastChannel', Channel);
    }
    logged = false;
    const cache = new QueryClient();
    mount(cache);
    await screen.findByLabelText(t('en', 'staffLogin.phone'));
    await signIn(method);
    fireEvent.click(screen.getByRole('button', { name: t('en', 'staffLogin.switchOperator') }));
    user = id(10);
    // The panel retains its selected login method while switching.
    if (method === 'pin')
      fireEvent.click(screen.getByRole('button', { name: t('en', 'staffLogin.useWhatsApp') }));
    await signIn(method);
    refuseLeave = true;
    fireEvent.click(screen.getByRole('button', { name: 'My leave' }));
    await screen.findByRole('button', { name: 'Retry' });
    refuseLeave = false;
    initial = false;
    current = {
      ...current,
      ...(change === 'branch' ? { branch_id: id(7) } : { device_id: id(8) }),
    };
    hold = true;
    zone = 'America/New_York';
    name = 'New paired branch';
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(release).toBeTypeOf('function'), { timeout: 1000 });
    expect(boots).toBe(2);
    expect(screen.queryByRole('button', { name: 'My leave' })).toBeNull();
    expect(reads).toBe(1);
    expect(writes).toBe(0);
    await act(async () => {
      hold = false;
      release?.();
    });
    await screen.findByText('New paired branch');
    expect(screen.getByLabelText('Branch time').textContent).toContain('06:00');
    fireEvent.click(await screen.findByRole('button', { name: 'My leave' }));
    await screen.findByLabelText('From date');
    expect(boots).toBe(2);
    expect(writes).toBe(0);
  },
);

async function bindingTransport(request: Request) {
  const path = new URL(request.url).pathname;
  if (path.endsWith('/devices/me')) {
    boots += 1;
    if (hold)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return Response.json(initial ? { branch_id: id(5), device_id: id(6) } : current);
  }
  if (path.endsWith('/staff-otp/request'))
    return Response.json({
      status: 'ACCEPTED',
      challenge_id: id(9),
      expires_in: 300,
      retry_after: 60,
      recovery: 'ASK_MANAGER',
    });
  if (path.endsWith('/staff-pin/sign-in') || path.endsWith('/staff-otp/verify')) {
    logged = true;
    return Response.json({
      ...current,
      user_id: user,
      company_id: id(1),
      business_id: id(2),
      expires_at: '2026-10-04T12:00:00Z',
    });
  }
  if (path.endsWith('/staff-session') && !logged) return Response.json({}, { status: 401 });
  if (path.endsWith('/staff-session'))
    return Response.json({
      ...current,
      user_id: user,
      company_id: id(1),
      business_id: id(2),
      expires_at: '2026-10-04T12:00:00Z',
    });
  if (path.endsWith('/attendance-qr')) {
    const now = Date.now();
    const window = Math.floor(now / 60000);
    return Response.json({
      token: { branch_id: current.branch_id, window, sig: 'ab'.repeat(32) },
      branch: { id: current.branch_id, name_ar: null, name_en: name, effective_timezone: zone },
      server_time: new Date(now).toISOString(),
      refresh_at: new Date((window + 1) * 60000).toISOString(),
      expires_at: new Date((window + 2) * 60000).toISOString(),
    });
  }
  if (path.includes('leave-requests')) {
    if (request.method === 'GET') reads += 1;
    else writes += 1;
    if (refuseLeave) return Response.json({ code: 'UNAUTHENTICATED' }, { status: 401 });
    return Response.json({
      items: [],
      next_cursor: null,
      request_branch_ids: [current.branch_id],
    });
  }
  return Response.json({});
}
