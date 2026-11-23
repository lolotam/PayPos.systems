import type { OwnServiceLines } from '@pospay/contracts';
import { type LinesView, type WorkData, shownMonth } from '../model/private-window-state';
import { monthOutOfRange } from '../model/work-error';
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
 * @returns الصفحة لو اتطبّقت على الشاشة، وغير كده undefined (فشل، أو جيل أو قراءة قديمة)
 */
export async function loadLines(
  host: WindowHost,
  scope: Scope,
  cursor: string | undefined,
): Promise<OwnServiceLines | undefined> {
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
  if (!result.ok) return undefined;
  const applied = host.commit(scope, {
    type: 'linesLoaded',
    page: result.value,
    append: cursor !== undefined,
  });
  return applied ? result.value : undefined;
}

/**
 * قراءة إكراميات الشهر؛ فشل النقل أو السيرفر بيظهر كخطأ بإعادة محاولة، مش كأن البلوك مخفي بقرار الصلاحيات.
 * الشهر خارج الحد (422) مبيتعدّش فشل إكراميات: القائمة نفسها بتعرض إشعاره.
 *
 * @param host المتحكم
 * @param scope نطاق الطلب
 */
export async function loadTips(host: WindowHost, scope: Scope) {
  const result = await settle(
    host,
    scope,
    () =>
      host.deps.calls.tips({
        mode: 'reception',
        month: scope.month,
        windowId: scope.windowId,
        signal: scope.signal,
      }),
    (error) => {
      if (!monthOutOfRange(error)) host.commit(scope, { type: 'tipsFailed' });
    },
  );
  if (result.ok) host.commit(scope, { type: 'tipsLoaded', tips: result.value });
}

/**
 * قراءة شهر كامل: الخدمات والإكراميات لنفس الشهر دايماً. من غير شهر مطلوب السيرفر هو اللي بيحدد «الحالي»
 * لكل طلب لوحده، وعبر حدود الشهر ممكن الاتنين يرجعوا شهرين مختلفين؛ فالإكراميات بتستنى أول صفحة خدمات
 * وبتتطلب بالشهر اللي رجعته (مصدر واحد للشهر). مع شهر صريح الاتنين بيمشوا مع بعض.
 *
 * @param host المتحكم
 * @param scope نطاق الطلب
 */
export async function loadMonth(host: WindowHost, scope: Scope): Promise<void> {
  if (scope.month !== undefined) {
    await Promise.all([loadLines(host, scope, undefined), loadTips(host, scope)]);
    return;
  }
  const first = await loadLines(host, scope, undefined);
  if (first !== undefined) await loadTips(host, { ...scope, month: first.month });
}

/**
 * الصفحة التالية بمؤشر آخر صفحة ومعاه شهرها: لو الشهر الحالي اتغيّر بين صفحتين مفيش خلط ومؤشر مرفوض.
 * فشلها بيسيب الصفحات المحمّلة ظاهرة، وإعادة النداء بتجرّب نفس المؤشر.
 *
 * @param host المتحكم
 * @param lines حالة الخدمات المعروضة
 */
export async function loadMoreLines(host: WindowHost, lines: LinesView): Promise<void> {
  const scope = host.scope(true);
  const last = lines.pages.at(-1);
  if (scope === undefined || !last?.next_cursor || lines.fetchingMore) return;
  if (host.commit(scope, { type: 'linesMore' }))
    await loadLines(host, { ...scope, month: last.month }, last.next_cursor);
}

/**
 * إعادة قراءة الإكراميات بس بعد فشلها، من غير ما نلمس الخدمات المعروضة، وبالشهر المعروض.
 *
 * @param host المتحكم
 * @param data بيانات الشاشة المفتوحة
 */
export async function retryTips(host: WindowHost, data: WorkData): Promise<void> {
  const scope = host.scope(true);
  if (scope === undefined || !host.commit(scope, { type: 'tipsRetry' })) return;
  await loadTips(host, { ...scope, month: shownMonth(data) ?? scope.month });
}
