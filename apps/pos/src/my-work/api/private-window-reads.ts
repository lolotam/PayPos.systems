import type { OwnCommissionEstimate, OwnServiceLines } from '@pospay/contracts';
import type { Scope, WindowHost } from '@/private-view/host';
import { type LinesView, type WorkAction, type WorkData, shownMonth } from '../model/private-window-state';
import { monthOutOfRange, workForbidden } from '../model/work-error';
import type { PrivateWindowCalls } from './private-window-env';

type WorkHost = WindowHost<WorkAction>;

type Settled<T> = { ok: true; value: T } | { ok: false };

/**
 * بيستنى الطلب وبيعالج رفضه بس؛ الرد الناجح بيرجع للمتصل يطبّقه برّه الـ try عشان أي خطأ وقت
 * التطبيق (مش خطأ طلب) يطلع للمتحكم ويقفل بدل ما يتحوّل لحالة فشل معروضة.
 */
async function settle<T>(
  host: WorkHost,
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
 * @param calls استدعاءات السيرفر
 * @param scope نطاق الطلب
 * @param cursor مؤشر الصفحة التالية أو undefined للأولى
 * @returns الصفحة لو اتطبّقت على الشاشة، وغير كده undefined (فشل، أو جيل أو قراءة قديمة)
 */
export async function loadLines(
  host: WorkHost,
  calls: PrivateWindowCalls,
  scope: Scope,
  cursor: string | undefined,
): Promise<OwnServiceLines | undefined> {
  const result = await settle(
    host,
    scope,
    () =>
      calls.lines({
        mode: 'reception',
        month: scope.month,
        windowId: scope.windowId,
        cursor,
        signal: scope.signal,
      }),
    (error) => host.commitData(scope, { type: 'linesFailed', error }),
  );
  if (!result.ok) return undefined;
  const applied = host.commitData(scope, {
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
 * @param calls استدعاءات السيرفر
 * @param scope نطاق الطلب
 */
export async function loadTips(host: WorkHost, calls: PrivateWindowCalls, scope: Scope) {
  const result = await settle(
    host,
    scope,
    () =>
      calls.tips({
        mode: 'reception',
        month: scope.month,
        windowId: scope.windowId,
        signal: scope.signal,
      }),
    (error) => {
      if (!monthOutOfRange(error)) host.commitData(scope, { type: 'tipsFailed' });
    },
  );
  if (result.ok) host.commitData(scope, { type: 'tipsLoaded', tips: result.value });
}

/**
 * قراءة تقدير العمولة للشهر المطلوب. أي 401 أو انتهاء النافذة بيعالجه المتحكم زي باقي القراءات، لكن 403 لتعطيل
 * العمولات أو منع `read:commissions:own` (وكمان 404 و503 وأعطال النقل) بيسيب التقدير غير محمّل: الكارت بيختفي
 * والخدمات والإكراميات بتفضل ظاهرة، ومبتقفلش نافذة «شغلي».
 *
 * @param host المتحكم
 * @param calls استدعاءات السيرفر
 * @param scope نطاق الطلب، وشهره هو الشهر الصريح اللي بيتطلب بيه التقدير
 */
export async function loadEstimate(
  host: WorkHost,
  calls: PrivateWindowCalls,
  scope: Scope,
): Promise<void> {
  const result = await settle<OwnCommissionEstimate | undefined>(host, scope, async () => {
    try {
      return await calls.commissionEstimate({
        mode: 'reception',
        month: scope.month,
        windowId: scope.windowId,
        signal: scope.signal,
      });
    } catch (error) {
      if (workForbidden(error)) return undefined;
      throw error;
    }
  });
  if (result.ok && result.value !== undefined)
    host.commitData(scope, { type: 'estimateLoaded', month: scope.month, estimate: result.value });
}

/**
 * قراءة شهر كامل: الخدمات والإكراميات لنفس الشهر دايماً. من غير شهر مطلوب السيرفر هو اللي بيحدد «الحالي»
 * لكل طلب لوحده، وعبر حدود الشهر ممكن الاتنين يرجعوا شهرين مختلفين؛ فالإكراميات بتستنى أول صفحة خدمات
 * وبتتطلب بالشهر اللي رجعته (مصدر واحد للشهر). مع شهر صريح الاتنين بيمشوا مع بعض.
 *
 * @param host المتحكم
 * @param calls استدعاءات السيرفر
 * @param scope نطاق الطلب
 */
export async function loadMonth(
  host: WorkHost,
  calls: PrivateWindowCalls,
  scope: Scope,
): Promise<void> {
  if (scope.month !== undefined) {
    await Promise.all([
      loadLines(host, calls, scope, undefined),
      loadTips(host, calls, scope),
      loadEstimate(host, calls, scope),
    ]);
    return;
  }
  const first = await loadLines(host, calls, scope, undefined);
  if (first === undefined) return;
  const monthScope = { ...scope, month: first.month };
  await Promise.all([loadTips(host, calls, monthScope), loadEstimate(host, calls, monthScope)]);
}

/**
 * الصفحة التالية بمؤشر آخر صفحة ومعاه شهرها: لو الشهر الحالي اتغيّر بين صفحتين مفيش خلط ومؤشر مرفوض.
 * فشلها بيسيب الصفحات المحمّلة ظاهرة، وإعادة النداء بتجرّب نفس المؤشر.
 *
 * @param host المتحكم
 * @param calls استدعاءات السيرفر
 * @param lines حالة الخدمات المعروضة
 */
export async function loadMoreLines(
  host: WorkHost,
  calls: PrivateWindowCalls,
  lines: LinesView,
): Promise<void> {
  const scope = host.scope(true);
  const last = lines.pages.at(-1);
  if (scope === undefined || !last?.next_cursor || lines.fetchingMore) return;
  if (host.commitData(scope, { type: 'linesMore' }))
    await loadLines(host, calls, { ...scope, month: last.month }, last.next_cursor);
}

/**
 * إعادة قراءة الإكراميات بس بعد فشلها، من غير ما نلمس الخدمات المعروضة، وبالشهر المعروض.
 *
 * @param host المتحكم
 * @param calls استدعاءات السيرفر
 * @param data بيانات الشاشة المفتوحة
 */
export async function retryTips(
  host: WorkHost,
  calls: PrivateWindowCalls,
  data: WorkData,
): Promise<void> {
  const scope = host.scope(true);
  if (scope === undefined || !host.commitData(scope, { type: 'tipsRetry' })) return;
  await loadTips(host, calls, { ...scope, month: shownMonth(data) ?? scope.month });
}
