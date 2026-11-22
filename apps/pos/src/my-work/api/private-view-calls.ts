import type { PrivateViewTouch, PrivateViewWindow } from '@pospay/contracts';
import { staffApiClient } from '@/shared/api/client';
import { WorkHttpError } from '../model/work-error';

const HEADER = 'x-private-view-window-id';

function refused(result: { error?: unknown; response: Response }): WorkHttpError {
  const body = result.error as { code?: unknown } | undefined;
  return new WorkHttpError(
    typeof body?.code === 'string' ? body.code : 'NOT_READY',
    result.response.status,
  );
}

/** نافذة العرض الخاص على جهاز الاستقبال: فتح بالـ PIN، لمس للتمديد، وإغلاق (D-A13). */
export const privateViewCalls = {
  /**
   * بيفتح النافذة بعد PIN جديد؛ الـ PIN بيتبعت مرة واحدة ومش بيتخزن.
   *
   * @param pin الأربع أرقام
   * @param signal بيلغي الطلب لو الرد اتأخر عن المهلة
   * @returns النافذة المفتوحة، وغير كده بيرمي WorkHttpError بالكود
   */
  open: async (pin: string, signal?: AbortSignal): Promise<PrivateViewWindow> => {
    const result = await staffApiClient().POST('/v1/staff/me/private-view', {
      body: { pin },
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    });
    if (result.data === undefined) throw refused(result);
    return result.data;
  },
  /**
   * بيلمس النافذة بعد إدخال؛ الرد هو الوقتين المتبقيين اللي الشاشة بتبني عليهم موعد القفل.
   *
   * @param windowId رقم النافذة المفتوحة
   * @param signal بيلغي الطلب لما الواجهة تتقفل
   * @returns الوقت المتبقي على الخمول وعلى السقف، وغير كده بيرمي WorkHttpError بالكود
   */
  touch: async (windowId: string, signal?: AbortSignal): Promise<PrivateViewTouch> => {
    const result = await staffApiClient().POST('/v1/staff/me/private-view/touch', {
      params: { header: { [HEADER]: windowId } },
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    });
    if (result.data === undefined) throw refused(result);
    return result.data;
  },
  /** إغلاق بأفضل جهد: الرد 204 دايماً، وفشل الشبكة ما بيمنعش مسح الشاشة. */
  close: async (windowId: string): Promise<void> => {
    try {
      await staffApiClient().POST('/v1/staff/me/private-view/close', {
        params: { header: { [HEADER]: windowId } },
        cache: 'no-store',
      });
    } catch {
      /* السيرفر بيقفلها بالخمول لوحده. */
    }
  },
};
