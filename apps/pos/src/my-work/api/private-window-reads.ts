import type { Scope, WindowHost } from './private-window-host';

type Settled<T> = { ok: true; value: T } | { ok: false };

/**
 * بيستنى الطلب وبيعالج رفضه بس؛ الرد الناجح بيرجع للمتصل يطبّقه برّه الـ try عشان أي خطأ وقت
 * التطبيق (مش خطأ طلب) يطلع للمتحكم ويقفل بدل ما يتحوّل لحالة فشل معروضة.
 */
async function settle<T>(
  host: WindowHost,
  scope: Scope,
  request: () => Promise<T>,
  onError?: (error: unknown) => void,
): Promise<Settled<T>> {
  try {
    return { ok: true, value: await request() };
  } catch (error) {
    if (!host.refused(scope, error)) onError?.(error);
    return { ok: false };
  }
}

/**
 * قراءة صفحة خدمات من الشهر المطلوب؛ الرد بيتطبّق بالجيل والموعد بس (commit)، وأي خطأ غير الانتهاء بيظهر في القائمة.
 *
 * @param host المتحكم
 * @param scope نطاق الطلب
 * @param cursor مؤشر الصفحة التالية أو undefined للأولى
 */
export async function loadLines(host: WindowHost, scope: Scope, cursor: string | undefined) {
  const result = await settle(
    host,
    scope,
    () =>
      host.deps.calls.lines({
        mode: 'reception',
        month: scope.month,
        windowId: scope.windowId,
        cursor,
        signal: scope.signal,
      }),
    (error) => host.commit(scope, { type: 'linesFailed', error }),
  );
  if (result.ok)
    host.commit(scope, { type: 'linesLoaded', page: result.value, append: cursor !== undefined });
}

/**
 * قراءة إكراميات الشهر؛ فشلها (غير الانتهاء) بيخلي البلوك مش ظاهر بس.
 *
 * @param host المتحكم
 * @param scope نطاق الطلب
 */
export async function loadTips(host: WindowHost, scope: Scope) {
  const result = await settle(host, scope, () =>
    host.deps.calls.tips({
      mode: 'reception',
      month: scope.month,
      windowId: scope.windowId,
      signal: scope.signal,
    }),
  );
  if (result.ok) host.commit(scope, { type: 'tipsLoaded', tips: result.value });
}
