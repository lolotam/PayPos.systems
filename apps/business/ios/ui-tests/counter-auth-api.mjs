// طبقة الـ HTTP: كل اتصال بالسيرفر في مكان واحد، والـ orchestrator يبقى عناه الـ child
// process والاستطلاع بس. الدوال هنا بترجع النتيجة أو بترمي، والقرار (متى نعمل وإمتى
// نعيد) بيفضل في الـ orchestrator.

import { leftoverDeviceIds, matchDeviceLabel } from './counter-auth-labels.mjs';

const API_BASE = 'https://api.staging.pospay.systems';
const APP_ORIGIN = 'https://app.staging.pospay.systems';
const FINAL_SWEEP_LIMIT_MS = 60_000;
const REVOKE_ATTEMPTS = 3;
const REVOKE_GAP_MS = 2_000;

// البيئة اللي التشغيل محتاجها: أسرار الـ owner وبيانات الفرع من ناحية السيرفر، وبيانات
// المحاكي ورقم التشغيل من ناحية الـ runner.
export const REQUIRED_ENV = [
  'STAGING_UI_OWNER_EMAIL',
  'STAGING_UI_OWNER_PASSWORD',
  'STAGING_UI_STAFF_PHONE',
  'STAGING_UI_STAFF_PIN',
  'STAGING_UI_COMPANY_ID',
  'STAGING_UI_BRANCH_ID',
  'SPIKE_UDID',
  'RUNNER_TEMP',
  'GITHUB_RUN_ID',
  'GITHUB_RUN_ATTEMPT',
];

export function readConfig(env) {
  const values = {};
  for (const key of REQUIRED_ENV) {
    const value = env[key];
    if (value === undefined || value === '') throw new Error('missing environment');
    values[key] = value;
  }
  return values;
}

export function collectCookies(headers) {
  return headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0] ?? '')
    .filter((cookie) => cookie.includes('='))
    .join('; ');
}

/** قيم الـ cookie نفسها (مش الأسماء): دي اللي بتتعمل لها mask عشان ما تظهرش في الـ log. */
export function cookieValues(cookie) {
  return cookie
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.includes('='))
    .map((part) => part.slice(part.indexOf('=') + 1))
    .filter((value) => value !== '');
}

export async function request(fetchImpl, url, options = {}) {
  const signals = [AbortSignal.timeout(30_000)];
  if (options.signal !== undefined) signals.push(options.signal);
  return fetchImpl(url, { ...options, signal: AbortSignal.any(signals) });
}

export async function signInOwner(fetchImpl, config, signal) {
  const response = await request(fetchImpl, `${API_BASE}/v1/auth/sign-in/email`, {
    method: 'POST',
    headers: { Origin: APP_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({
      email: config.STAGING_UI_OWNER_EMAIL,
      password: config.STAGING_UI_OWNER_PASSWORD,
    }),
    signal,
  });
  if (!response.ok) throw new Error('owner sign-in failed');
  const cookie = collectCookies(response.headers);
  if (cookie === '') throw new Error('owner cookie missing');
  return cookie;
}

/** إنهاء جلسة الـ owner: بيترجع بالنتيجة ('done' أو 'failed') بدل ما يرمي، عشان آخر التشغيل يكمّل. */
export async function signOutOwner(fetchImpl, cookie) {
  try {
    const response = await request(fetchImpl, `${API_BASE}/v1/auth/sign-out`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: APP_ORIGIN },
    });
    return response.ok ? 'done' : 'failed';
  } catch {
    return 'failed';
  }
}

export async function issuePairingCode(fetchImpl, config, cookie, signal) {
  const response = await request(
    fetchImpl,
    `${API_BASE}/v1/branches/${config.STAGING_UI_BRANCH_ID}/devices/pairing-code`,
    {
      method: 'POST',
      headers: { Cookie: cookie, 'x-company-id': config.STAGING_UI_COMPANY_ID },
      signal,
    },
  );
  if (!response.ok) throw new Error('pairing code failed');
  const body = await response.json();
  if (typeof body.code !== 'string' || body.code === '') throw new Error('pairing code missing');
  return body.code;
}

export async function fetchPendingDevicePages(fetchImpl, config, cookie, signal) {
  const pages = [];
  const seen = new Set();
  let cursor = null;
  do {
    if (cursor !== null && seen.has(cursor)) throw new Error('repeated device cursor');
    if (cursor !== null) seen.add(cursor);
    const url = new URL(`${API_BASE}/v1/branches/${config.STAGING_UI_BRANCH_ID}/devices`);
    url.searchParams.set('status', 'pending');
    url.searchParams.set('limit', '100');
    if (cursor !== null) url.searchParams.set('cursor', cursor);
    const response = await request(fetchImpl, url, {
      headers: { Cookie: cookie, 'x-company-id': config.STAGING_UI_COMPANY_ID },
      signal,
    });
    if (!response.ok) throw new Error('pending devices failed');
    const page = await response.json();
    if (!Array.isArray(page.items)) throw new Error('pending devices malformed');
    pages.push(page);
    cursor = typeof page.next_cursor === 'string' && page.next_cursor !== '' ? page.next_cursor : null;
  } while (cursor !== null);
  return pages;
}

export async function changeDevice(fetchImpl, config, cookie, action, id, signal) {
  const response = await request(
    fetchImpl,
    `${API_BASE}/v1/branches/${config.STAGING_UI_BRANCH_ID}/devices/${id}/${action}`,
    {
      method: 'POST',
      headers: { Cookie: cookie, 'x-company-id': config.STAGING_UI_COMPANY_ID },
      signal,
    },
  );
  if (response.status !== 204) throw new Error(`device ${action} failed`);
}

/** آخر بحث بالاسم: مرور واحد على كل الصفحات، محدود بستين ثانية. */
export async function findDeviceByLabel(fetchImpl, config, cookie, label) {
  try {
    const pages = await fetchPendingDevicePages(
      fetchImpl,
      config,
      cookie,
      AbortSignal.timeout(FINAL_SWEEP_LIMIT_MS),
    );
    return matchDeviceLabel(pages, label);
  } catch {
    return null;
  }
}

/** المراجعة بتتكرر ثلاث مرات: فشل واحد في الشبكة مش معناه إن الجهاز فاضل معلق. */
export async function revokeWithRetries(deps, config, cookie, id) {
  for (let attempt = 1; attempt <= REVOKE_ATTEMPTS; attempt += 1) {
    try {
      await changeDevice(deps.fetch, config, cookie, 'revoke', id);
      return 'done';
    } catch {
      if (attempt === REVOKE_ATTEMPTS) return 'failed';
      try {
        await deps.sleep(REVOKE_GAP_MS);
      } catch {}
    }
  }
  return 'failed';
}

/** تنظيف أول التشغيل: الأجهزة المعلّقة من تشغيلات مقتولة بتتشال قبل كود الاقتران الجديد. */
export async function sweepLeftovers(deps, config, cookie, signal) {
  const pages = await fetchPendingDevicePages(deps.fetch, config, cookie, signal);
  const ids = leftoverDeviceIds(pages, deps.now());
  for (const id of ids) {
    try {
      await changeDevice(deps.fetch, config, cookie, 'revoke', id, signal);
    } catch {
      return 'failed';
    }
  }
  return `${ids.length} revoked`;
}

/** تنظيف بقايا التشغيلات المقتولة، ثم كود الاقتران الجديد: النتيجة والكود. */
export async function preparePairing(deps, config, cookie, signal) {
  let leftover = 'failed';
  try {
    leftover = await sweepLeftovers(deps, config, cookie, signal);
  } catch {
    leftover = 'failed';
  }
  let code = '';
  try {
    code = await issuePairingCode(deps.fetch, config, cookie, signal);
  } catch {}
  return { leftover, code };
}

/**
 * مراجعة الجهاز بالاسم: بحث محدود بالاسم لو الـ id لسه مش معروف، وبعدها مراجعة الجهاز.
 * بترجع الـ id اللي اتقفل (أو null) ونتيجة المراجعة.
 */
export async function revokeDeviceByLabel(deps, config, cookie, label, deviceId) {
  let id = deviceId;
  if (id === null && label !== '') {
    const found = await findDeviceByLabel(deps.fetch, config, cookie, label);
    if (found !== null) id = found;
  }
  if (id === null) return { id: null, outcome: 'skipped' };
  return { id, outcome: await revokeWithRetries(deps, config, cookie, id) };
}
