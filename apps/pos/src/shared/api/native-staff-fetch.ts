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

/** معلومات رد أصلي وصل متأخراً بعد إلغاء إشارته لتحديث الحالة المحلية عند اللزوم. */
export interface LateAbortedNativeResponse {
  url: string;
  method: string;
  status: number;
  data: unknown;
  headers: Headers;
}

const lateAbortedListeners = new Set<(response: LateAbortedNativeResponse) => void>();

/** يسجل مستمعاً يتلقى رد CapacitorHttp إذا وصل بعد إلغاء إشارة الطلب الأصلي. */
export function onLateAbortedNativeResponse(
  listener: (response: LateAbortedNativeResponse) => void,
): () => void {
  lateAbortedListeners.add(listener);
  return () => {
    lateAbortedListeners.delete(listener);
  };
}

function isNativeMutation(method: string): boolean {
  const normalized = method.toUpperCase();
  return normalized !== 'GET' && normalized !== 'HEAD';
}

function notifyLateAbortedResponse(
  options: NativeHttpOptions,
  nativeResponse: NativeHttpResponse,
): void {
  if (lateAbortedListeners.size === 0) return;
  const payload: LateAbortedNativeResponse = {
    url: options.url,
    method: options.method.toUpperCase(),
    status: nativeResponse.status,
    data: nativeResponse.data,
    headers: safeResponseHeaders(nativeResponse.headers),
  };
  for (const listener of [...lateAbortedListeners]) {
    try {
      listener(payload);
    } catch {
      /* فشل مستمع جانبي لا يعطّل بقية السياج. */
    }
  }
}

/** أقصى مدة انتظار لاكتمال طلب أصلي سابق ملغي قبل رفض الطلبات التالية بمهلة واضحة بدل التعليق للأبد. */
export const NATIVE_FENCE_TIMEOUT_MS = 15_000;

// طلب أصلي اتلغى من ناحية JS ممكن يكون لسه شغال ويمسح كوكي أحدث لما يرجع:
// بنوقّف الطلب الأصلي اللي بعده لحد ما اللي اتلغى يخلص من نظام التشغيل أو يخلص بمهلة السياج.
let pendingAbortedNativeCall: Promise<void> | null = null;
// طلبات التعديل الأصلية تشارك مخزن كوكيز واحد على الجسر الأصلي، فكل طلب بيحجز دوره فوراً بترتيب FIFO.
let mutationQueueTail: Promise<void> | null = null;

interface MutationTurn {
  previous: Promise<void> | null;
  releaseIfUnstarted: () => void;
  releaseAfter: (settled: Promise<void>) => void;
}

function reserveMutationTurn(): MutationTurn {
  const previous = mutationQueueTail;
  let handedOff = false;
  let released = false;
  let resolveTurn!: () => void;
  const ownTurn = new Promise<void>((resolve) => {
    resolveTurn = resolve;
  });
  mutationQueueTail = ownTurn;
  const finishRelease = (): void => {
    if (mutationQueueTail === ownTurn) mutationQueueTail = null;
    resolveTurn();
  };
  const releaseOnce = (): void => {
    if (released) return;
    released = true;
    if (previous === null) finishRelease();
    else void previous.then(finishRelease);
  };
  return {
    previous,
    releaseIfUnstarted: () => {
      if (!handedOff) releaseOnce();
    },
    releaseAfter: (settled: Promise<void>) => {
      handedOff = true;
      void settled.finally(releaseOnce);
    },
  };
}

async function waitForNativeTurn(
  previousTurn: Promise<void> | null,
  aborted: AbortRace,
): Promise<void> {
  let previousDone = previousTurn === null;
  const trackedPrevious =
    previousTurn === null
      ? null
      : previousTurn.then(() => {
          previousDone = true;
        });
  if (previousDone && pendingAbortedNativeCall === null) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error('NATIVE_FETCH_FENCE_TIMEOUT')),
      NATIVE_FENCE_TIMEOUT_MS,
    );
  });
  try {
    // السياج ممكن يكبر بطلب تاني اتلغى أو دور سابق شغال، فبنعيد الفحص بعد كل تسوية تحت مهلة واحدة.
    while (!previousDone || pendingAbortedNativeCall !== null) {
      const blocker = pendingAbortedNativeCall ?? trackedPrevious;
      if (blocker === null) break;
      await Promise.race([blocker, aborted.rejected, timeout]);
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

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
  // لو الإشارة اتلغت قبل تعليق Promise.race، نمنع unhandledRejection.
  void rejected.catch(() => undefined);
  return {
    rejected,
    release: (): void => {
      if (holder.onAbort !== undefined) signal.removeEventListener('abort', holder.onAbort);
    },
  };
}

function enqueueAbortedCall(settled: Promise<void>): void {
  const next = (pendingAbortedNativeCall ?? Promise.resolve()).then(() => settled);
  pendingAbortedNativeCall = next;
  void next.finally(() => {
    if (pendingAbortedNativeCall === next) pendingAbortedNativeCall = null;
  });
}

async function raceWithAbortFence(
  requestPromise: Promise<NativeHttpResponse>,
  options: NativeHttpOptions,
  settled: Promise<void>,
  signal: AbortSignal,
  aborted: AbortRace,
): Promise<NativeHttpResponse> {
  let finished = false;
  let fenced = false;
  const enterFence = (): void => {
    if (fenced || finished || !signal.aborted) return;
    fenced = true;
    enqueueAbortedCall(settled);
    // لو الطلب اتلغى قبل ما نتيجته ترجع للمتصل، نبلغ المستمعين لو السيرفر نفّذه متأخر بعد الإلغاء.
    void requestPromise.then(
      (lateResponse) => notifyLateAbortedResponse(options, lateResponse),
      () => undefined,
    );
  };
  // تسجيل السياج فور الإلغاء يمنع أي طلب يتفتح في نفس الـ microtask من تفادي الانتظار.
  signal.addEventListener('abort', enterFence, { once: true });
  try {
    const response = await Promise.race([requestPromise, aborted.rejected]);
    if (!signal.aborted) finished = true;
    return response;
  } finally {
    signal.removeEventListener('abort', enterFence);
    enterFence();
  }
}

/**
 * بيستنى دور التعديل المحجوز وأي طلب أصلي سابق اتلغى قبل ما يفتح طلب جديد، ولو الطلب الجديد
 * اتلغى قبل ما الإضافة الأصلية تخلص بيحجز اللي بعده لحد ما المكالمة الجارية تهدأ.
 */
async function sendFencedNativeRequest(
  client: NativeHttpClient,
  options: NativeHttpOptions,
  signal: AbortSignal,
  aborted: AbortRace,
  mutationTurn: MutationTurn | null,
): Promise<NativeHttpResponse> {
  await waitForNativeTurn(mutationTurn?.previous ?? null, aborted);
  throwIfAborted(signal);
  const requestPromise = client.request(options);
  const settled = requestPromise.then(
    () => undefined,
    () => undefined,
  );
  mutationTurn?.releaseAfter(settled);
  return raceWithAbortFence(requestPromise, options, settled, signal, aborted);
}

// الـ web view على iOS مابيبعتش كوكي مضيف الـ API من `capacitor://localhost` والمتصفح بيسقط `Origin`، فالطلبات دي بتعدي أصلية.
let capacitorHttpClient: Promise<NativeHttpClient> | null = null;

function loadCapacitorHttp(): Promise<NativeHttpClient> {
  if (capacitorHttpClient === null) {
    // تحميل الإضافة مرة واحدة يمنع سباق الاستيراد المتزامن ويحمي حزمة الويب.
    capacitorHttpClient = import('@capacitor/core')
      .then(({ CapacitorHttp }) => CapacitorHttp)
      .catch((error: unknown) => {
        capacitorHttpClient = null;
        throw error;
      });
  }
  return capacitorHttpClient;
}

function buildNativeOptions(
  request: Request,
  headers: Record<string, string>,
  body: string,
): NativeHttpOptions {
  return {
    url: request.url,
    method: request.method,
    headers,
    ...(body === '' ? {} : { data: body }),
    disableRedirects: true,
    connectTimeout: 15000,
    readTimeout: 15000,
    responseType: 'text',
  };
}

export async function nativeStaffFetch(request: Request): Promise<Response> {
  assertApiOrigin(request.url);
  throwIfAborted(request.signal);
  const mutationTurn = isNativeMutation(request.method) ? reserveMutationTurn() : null;
  try {
    const headers = {
      ...Object.fromEntries(request.headers.entries()),
      Origin: 'capacitor://localhost',
    };
    const body = request.method === 'GET' || request.method === 'HEAD' ? '' : await request.text();
    throwIfAborted(request.signal);
    const client = await loadCapacitorHttp();
    throwIfAborted(request.signal);
    const aborted = untilAborted(request.signal);
    try {
      const nativeResponse = await sendFencedNativeRequest(
        client,
        buildNativeOptions(request, headers, body),
        request.signal,
        aborted,
        mutationTurn,
      );
      throwIfAborted(request.signal);
      const responseHeaders = safeResponseHeaders(nativeResponse.headers);
      const empty = request.method === 'HEAD' || [204, 205, 304].includes(nativeResponse.status);
      const responseBody = empty
        ? null
        : responseBodyText(nativeResponse.data, responseHeaders.get('content-type') ?? '');
      return new Response(responseBody, {
        status: nativeResponse.status,
        headers: responseHeaders,
      });
    } finally {
      aborted.release();
    }
  } finally {
    mutationTurn?.releaseIfUnstarted();
  }
}
