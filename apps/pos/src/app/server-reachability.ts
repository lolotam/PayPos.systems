import { apiOrigin } from '@/shared/api/origin';
import { usesNativeStaffTransport } from '@/shared/platform/native-shell';

/** مهلة فحص السيرفر قبل أول حفظ للدور عشان الشاشة ما تفضلش معلّقة (PP-286 F-3). */
export const FIRST_SAVE_REACHABILITY_WAIT_MS = 5_000;

function hasOkStatus(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    'status' in body &&
    (body as { status?: unknown }).status === 'ok'
  );
}

function parseNativePayload(data: unknown): unknown {
  if (typeof data !== 'string') return data;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function readHealthViaFetch(healthUrl: string, signal: AbortSignal): Promise<boolean> {
  const request = new Request(healthUrl, {
    method: 'GET',
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    signal,
  });
  const response = await fetch(request);
  if (response.status !== 200) return false;
  return hasOkStatus(await response.json());
}

// فحص `/health` لا يحمل كوكي ولا يمر بسياج الطلبات المصرحة حتى لا تُعطِّل المهلة إعادة المحاولة (PR #1389).
async function readHealthViaNativeHttp(healthUrl: string): Promise<boolean> {
  const { CapacitorHttp } = await import('@capacitor/core');
  const response = await CapacitorHttp.request({
    url: healthUrl,
    method: 'GET',
    headers: {
      'Cache-Control': 'no-cache, no-store, max-age=0',
      Pragma: 'no-cache',
    },
    disableRedirects: true,
    connectTimeout: FIRST_SAVE_REACHABILITY_WAIT_MS,
    readTimeout: FIRST_SAVE_REACHABILITY_WAIT_MS,
    responseType: 'text',
  });
  if (response.status !== 200) return false;
  return hasOkStatus(parseNativePayload(response.data));
}

/**
 * فحص سريع إن السيرفر نفسه بيردّ مش بوابة واي فاي مقفولة (captive portal).
 * بيرجع false عند انتهاء المهلة أو فشل الشبكة أو أي رد غير `{ status: 'ok' }` بحالة 200.
 *
 * @returns true إذا استجاب السيرفر بحالة ok خلال المهلة، وإلا false
 */
export async function checkServerReachable(): Promise<boolean> {
  const healthUrl = `${apiOrigin()}/health`;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(false);
    }, FIRST_SAVE_REACHABILITY_WAIT_MS);
  });
  try {
    const check = usesNativeStaffTransport()
      ? readHealthViaNativeHttp(healthUrl)
      : readHealthViaFetch(healthUrl, controller.signal);
    return await Promise.race([check, timedOut]);
  } catch {
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
