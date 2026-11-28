import { nativeStaffFetch } from '@/shared/api/native-staff-fetch';
import { apiOrigin } from '@/shared/api/origin';
import { usesNativeStaffTransport } from '@/shared/platform/native-shell';

/** مهلة فحص السيرفر قبل أول حفظ للدور عشان الشاشة ما تفضلش معلّقة (PP-286 F-3). */
export const FIRST_SAVE_REACHABILITY_WAIT_MS = 5_000;

async function readHealthOk(
  transport: (request: Request) => Promise<Response>,
  request: Request,
): Promise<boolean> {
  const response = await transport(request);
  if (response.status !== 200) return false;
  const body: unknown = await response.json();
  return (
    typeof body === 'object' &&
    body !== null &&
    'status' in body &&
    (body as { status?: unknown }).status === 'ok'
  );
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
    const request = new Request(healthUrl, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
    });
    const transport = usesNativeStaffTransport() ? nativeStaffFetch : fetch;
    return await Promise.race([readHealthOk(transport, request), timedOut]);
  } catch {
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
