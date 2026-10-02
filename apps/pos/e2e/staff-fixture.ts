import {
  expect,
  type BrowserContext,
  type Page,
  type Route,
  type Request as BrowserRequest,
} from '@playwright/test';
import { t } from '@pospay/i18n';

export const ids = {
  company: '01920000-0000-7000-8000-000000000001',
  business: '01920000-0000-7000-8000-000000000002',
  branch: '01920000-0000-7000-8000-000000000003',
  device: '01920000-0000-7000-8000-000000000004',
};
export const code = () => String(7).padStart(6, '0');
export const phone = '+99900000001';

export async function staffFixture(context: BrowserContext) {
  const state = {
    operator: false,
    userId: '01920000-0000-7000-8000-000000000005',
    requestedUserId: '01920000-0000-7000-8000-000000000005',
    revoked: false,
    unavailable: false,
    sequence: 0,
    challenge: '',
    verifiedChallenge: '',
    deviceHeader: false,
    cookieHeader: false,
    probes: 0,
  };
  await context.route('**/v1/**', (route) => handleRoute(route, state));
  return state;
}
type FixtureState = Awaited<ReturnType<typeof staffFixture>>;
type Json = (status: number, body: unknown, cookie?: string) => Promise<void>;

async function handleRoute(route: Route, state: FixtureState) {
  const request = route.request(),
    path = new URL(request.url()).pathname;
  const headers = {
    'access-control-allow-origin': request.headers()['origin'] ?? '*',
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  };
  const json = (status: number, body: unknown, cookie?: string) =>
    route.fulfill({
      status,
      json: body,
      headers: { ...headers, ...(cookie === undefined ? {} : { 'set-cookie': cookie }) },
    });
  if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
  const invalid = {
    code: 'OTP_INVALID',
    message_ar: t('ar', 'errors.OTP_INVALID'),
    message_en: t('en', 'errors.OTP_INVALID'),
  };
  if (state.revoked) return json(401, invalid);
  if (path.endsWith('/devices/me'))
    return json(200, { device_id: ids.device, company_id: ids.company, branch_id: ids.branch });
  if (path.includes('/staff-otp/')) return handleOtp(request, state, json, invalid);
  if (path.endsWith('/staff-session/sign-out')) {
    state.operator = false;
    return json(
      200,
      { status: 'SIGNED_OUT' },
      'pospay-staff.session_token=; Path=/v1; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
    );
  }
  if (path.endsWith('/staff-session')) {
    state.probes++;
    state.deviceHeader ||= request.headers()['authorization'] === 'Device synthetic-device';
    state.cookieHeader ||= (request.headers()['cookie'] ?? '').includes(
      'pospay-staff.session_token=',
    );
    return json(state.operator ? 200 : 401, state.operator ? session(state.userId) : invalid);
  }
  if (path.endsWith('/staff-pin/sign-in')) {
    if (request.postDataJSON().pin !== String(10).padStart(4, '0'))
      return json(401, { ...invalid, code: 'PIN_INVALID' });
    state.operator = true;
    return json(
      200,
      session(state.userId),
      'pospay-staff.session_token=synthetic; Path=/v1; HttpOnly; Secure; SameSite=Lax',
    );
  }
  return json(404, invalid);
}

async function handleOtp(
  request: BrowserRequest,
  state: FixtureState,
  json: Json,
  invalid: object,
) {
  if (request.url().endsWith('/request')) {
    if (state.unavailable) return json(503, { ...invalid, code: 'OTP_UNAVAILABLE' });
    state.challenge = `01920000-0000-7000-8000-${String(++state.sequence).padStart(12, '0')}`;
    state.requestedUserId =
      request.postDataJSON().phone === '+99900000002'
        ? '01920000-0000-7000-8000-000000000006'
        : '01920000-0000-7000-8000-000000000005';
    return json(202, {
      status: 'ACCEPTED',
      challenge_id: state.challenge,
      expires_in: 300,
      retry_after: 60,
      recovery: 'ASK_MANAGER',
    });
  }
  const input = request.postDataJSON() as { challenge_id: string; code: string };
  state.verifiedChallenge = input.challenge_id;
  if (input.challenge_id !== state.challenge || input.code !== code()) return json(401, invalid);
  state.operator = true;
  state.userId = state.requestedUserId;
  return json(
    200,
    session(state.userId),
    'pospay-staff.session_token=synthetic; Path=/v1; HttpOnly; Secure; SameSite=Lax',
  );
}

function session(userId: string) {
  return {
    user_id: userId,
    company_id: ids.company,
    business_id: ids.business,
    branch_id: ids.branch,
    device_id: ids.device,
    expires_at: new Date(Date.now() + 28_800_000).toISOString(),
  };
}

export async function pairedPage(page: Page) {
  if (!process.env['POS_E2E_URL']) throw new Error('POS_E2E_URL_REQUIRED');
  await page.goto('/');
  await page.evaluate(async (scope) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('pospay-pos', 10);
      opening.onupgradeneeded = () => {
        if (!opening.result.objectStoreNames.contains('credentials'))
          opening.result.createObjectStore('credentials', { keyPath: 'id' });
      };
      opening.onerror = () => reject(new Error('SYNTHETIC_DEVICE_STORE_FAILED'));
      opening.onsuccess = () => resolve(opening.result);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('credentials', 'readwrite');
      tx.objectStore('credentials').put({
        id: 'current',
        company_id: scope.company,
        device_id: scope.device,
        claim_secret: null,
        device_token: 'synthetic-device',
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('SYNTHETIC_DEVICE_STORE_FAILED'));
    });
    db.close();
  }, ids);
  await page.reload();
  await expect(page.getByRole('heading', { name: t('ar', 'staffLogin.title') })).toBeVisible();
}

export async function requestCode(page: Page, number = phone) {
  await page.getByLabel(t('ar', 'staffLogin.phone')).fill(number);
  await page.getByLabel(t('ar', 'staffLogin.language')).selectOption('ar');
  await page.getByRole('button', { name: t('ar', 'staffLogin.request') }).click();
}
export async function verifyCode(page: Page, value = code()) {
  await page.getByLabel(t('ar', 'staffLogin.code')).fill(value);
  await page.getByRole('button', { name: t('ar', 'staffLogin.verify') }).click();
}
