import { apiOrigin } from './origin';

function assertApiOrigin(requestUrl: string): void {
  if (new URL(requestUrl).origin !== new URL(apiOrigin()).origin) {
    throw new Error('NATIVE_FETCH_FOREIGN_URL');
  }
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function safeResponseHeaders(nativeHeaders: Record<string, string>): Headers {
  return new Headers(
    Object.fromEntries(
      Object.entries(nativeHeaders).filter(([name]) => name.toLowerCase() !== 'set-cookie'),
    ),
  );
}

function responseBodyText(data: unknown, contentType: string): string | undefined {
  // Capacitor 8.5.3 بيفك application/json قبل اختيار text، حتى لو الناتج قيمة string.
  if (contentType.toLowerCase().includes('application/json')) return JSON.stringify(data);
  return typeof data === 'string' ? data : JSON.stringify(data);
}

type AbortRace = { rejected: Promise<never>; release: () => void };

interface NativeHttpOptions {
  url: string;
  method: string;
  headers: Record<string, string>;
  data?: string;
  disableRedirects: boolean;
  connectTimeout: number;
  readTimeout: number;
  responseType: 'text';
}

interface NativeHttpResponse {
  status: number;
  data: unknown;
  headers: Record<string, string>;
}

interface NativeHttpClient {
  request(options: NativeHttpOptions): Promise<NativeHttpResponse>;
}

// طلب أصلي اتلغى من ناحية JS ممكن يكون لسه شغال ويمسح كوكي أحدث لما يرجع:
// بنوقّف الطلب الأصلي اللي بعده لحد ما اللي اتلغى يخلص من نظام التشغيل.
let pendingAbortedNativeCall: Promise<void> = Promise.resolve();

/**
 * وعد يرفض بإشارة الإلغاء أول ما الإشارة تشتغل.
 *
 * الطلب الأصلي مابيدعمش الإلغاء من جوه، فلو استنّيناه كان المستخدم هيفضل مستني لحد ما
 * الطلب يخلص أو يخلص بمهلته (15 ثانية)، والإلغاء لازم يردّ فورًا زي أي `fetch`.
 */
function untilAborted(signal: AbortSignal): AbortRace {
  const holder: { onAbort?: () => void } = {};
  const rejected = new Promise<never>((_resolve, reject) => {
    const onAbort = (): void => reject(abortError());
    holder.onAbort = onAbort;
    signal.addEventListener('abort', onAbort, { once: true });
    // ممكن تكون الإشارة اتلغت قبل ما المستمع يتسجل، فبنرفض على طول.
    if (signal.aborted) onAbort();
  });
  return {
    rejected,
    release: (): void => {
      if (holder.onAbort !== undefined) signal.removeEventListener('abort', holder.onAbort);
    },
  };
}

/**
 * بيستنى أي طلب أصلي سابق اتلغى قبل ما يفتح طلب جديد، ولو الطلب الجديد اتلغى قبل ما
 * الإضافة الأصلية تخلص بيحجز اللي بعده لحد ما المكالمة الجارية تهدأ.
 */
async function sendFencedNativeRequest(
  client: NativeHttpClient,
  options: NativeHttpOptions,
  signal: AbortSignal,
  aborted: AbortRace,
): Promise<NativeHttpResponse> {
  await Promise.race([pendingAbortedNativeCall, aborted.rejected]);
  throwIfAborted(signal);
  const requestPromise = client.request(options);
  const settled = requestPromise.then(
    () => undefined,
    () => undefined,
  );
  let finished = false;
  try {
    const response = await Promise.race([requestPromise, aborted.rejected]);
    finished = true;
    return response;
  } finally {
    if (!finished && signal.aborted) {
      pendingAbortedNativeCall = pendingAbortedNativeCall.then(() => settled);
    }
  }
}

// الـ web view على iOS مابيبعتش كوكي مضيف الـ API من `capacitor://localhost` والمتصفح بيسقط `Origin`، فالطلبات دي بتعدي أصلية.
export async function nativeStaffFetch(request: Request): Promise<Response> {
  assertApiOrigin(request.url);
  throwIfAborted(request.signal);
  const headers = {
    ...Object.fromEntries(request.headers.entries()),
    Origin: 'capacitor://localhost',
  };
  const body = request.method === 'GET' || request.method === 'HEAD' ? '' : await request.text();
  throwIfAborted(request.signal);
  const { CapacitorHttp } = await import('@capacitor/core');
  throwIfAborted(request.signal);
  const aborted = untilAborted(request.signal);
  try {
    const nativeResponse = await sendFencedNativeRequest(
      CapacitorHttp,
      {
        url: request.url,
        method: request.method,
        headers,
        ...(body === '' ? {} : { data: body }),
        disableRedirects: true,
        connectTimeout: 15000,
        readTimeout: 15000,
        responseType: 'text',
      },
      request.signal,
      aborted,
    );
    throwIfAborted(request.signal);
    const responseHeaders = safeResponseHeaders(nativeResponse.headers);
    const empty = request.method === 'HEAD' || [204, 205, 304].includes(nativeResponse.status);
    const responseBody = empty
      ? null
      : responseBodyText(nativeResponse.data, responseHeaders.get('content-type') ?? '');
    return new Response(responseBody, { status: nativeResponse.status, headers: responseHeaders });
  } finally {
    aborted.release();
  }
}
