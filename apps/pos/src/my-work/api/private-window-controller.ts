import { type PrivateViewData, PrivateViewController } from '@/private-view/controller';
import {
  type WorkAction,
  type WorkData,
  EMPTY_DATA,
  reduceWorkData,
} from '../model/private-window-state';
import type { PrivateWindowCalls, PrivateWindowDeps } from './private-window-env';
import { loadMoreLines, loadMonth, retryTips } from './private-window-reads';

/** بيانات «شغلي» الخاصة بالنافذة: الشكل والمطالعة بيخصّوا «شغلي» نفسه. */
function workData(calls: PrivateWindowCalls): PrivateViewData<WorkData, WorkAction> {
  return {
    empty: EMPTY_DATA,
    reduce: reduceWorkData,
    monthAction: (month) => ({ type: 'month', month }),
    retryAction: { type: 'retry' },
    month: (data) => data.month,
    load: (host, scope) => loadMonth(host, calls, scope),
  };
}

/**
 * نافذة «شغلي» الخاصة على جهاز الاستقبال: بتستخدم متحكم النافذة المشترك، واللي بيقرا خدمات الشهر
 * والإكراميات والتقدير جوّا النافذة المفتوحة (من غير كاش ولا تخزين).
 */
export class PrivateWindowController extends PrivateViewController<WorkData, WorkAction> {
  private readonly calls: PrivateWindowCalls;

  constructor(deps: PrivateWindowDeps, onLeave: () => void) {
    super(deps, onLeave, workData(deps.calls));
    this.calls = deps.calls;
  }

  /** إعادة قراءة الإكراميات بس بعد فشلها. */
  retryTips(): void {
    const data = this.getData();
    if (data !== undefined) void this.guard(retryTips(this, this.calls, data));
  }

  loadMore(): void {
    const data = this.getData();
    if (data !== undefined) void this.guard(loadMoreLines(this, this.calls, data.lines));
  }
}
