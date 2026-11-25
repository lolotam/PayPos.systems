import type {
  OwnCommissionEstimate,
  OwnRatingSummary,
  OwnServiceLines,
  OwnTips,
} from '@pospay/contracts';
import { personalApiClient, staffApiClient } from '@/shared/api/client';
import type { WorkContext } from '../model/work-context';
import { WorkHttpError } from '../model/work-error';

const HEADER = 'x-private-view-window-id';

type Read = {
  mode: WorkContext['mode'];
  month: string | undefined;
  windowId: string | undefined;
  signal: AbortSignal;
};

// الموبايل الشخصي بيستعمل كوكي الجلسة الشخصية بس، وجهاز الاستقبال بيستعمل توكن الجهاز وراه النافذة.
function client(mode: WorkContext['mode']) {
  return mode === 'reception' ? staffApiClient() : personalApiClient();
}
function windowHeader(read: Read) {
  return read.windowId === undefined ? {} : { [HEADER]: read.windowId };
}
function value<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.data !== undefined) return result.data;
  const body = result.error as { code?: unknown } | undefined;
  throw new WorkHttpError(
    typeof body?.code === 'string' ? body.code : 'NOT_READY',
    result.response.status,
  );
}

/** قراءات «شغلي» بالـ client المولّد؛ الموظفة بتتحدد من الجلسة في السيرفر مش من أي حقل هنا. */
export const workCalls = {
  lines: async (read: Read & { cursor: string | undefined }): Promise<OwnServiceLines> =>
    value(
      await client(read.mode).GET('/v1/staff/me/service-lines', {
        signal: read.signal,
        cache: 'no-store',
        params: {
          header: windowHeader(read),
          query: {
            ...(read.month ? { month: read.month } : {}),
            ...(read.cursor ? { cursor: read.cursor } : {}),
            limit: 20,
          },
        },
      }),
    ),
  tips: async (read: Read): Promise<OwnTips> =>
    value(
      await client(read.mode).GET('/v1/staff/me/tips', {
        signal: read.signal,
        cache: 'no-store',
        params: { header: windowHeader(read), query: read.month ? { month: read.month } : {} },
      }),
    ),
  commissionEstimate: async (read: Read): Promise<OwnCommissionEstimate> =>
    value(
      await client(read.mode).GET('/v1/staff/me/commission-estimate', {
        signal: read.signal,
        cache: 'no-store',
        params: { header: windowHeader(read), query: read.month ? { month: read.month } : {} },
      }),
    ),
  // مسار التقييم للجلسة الشخصية بس (RS-10)، فمفيش نافذة ولا توكن جهاز.
  ratingSummary: async (signal: AbortSignal): Promise<OwnRatingSummary> =>
    value(
      await personalApiClient().GET('/v1/staff/me/rating-summary', { signal, cache: 'no-store' }),
    ),
};
