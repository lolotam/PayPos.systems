import type { OwnServiceLines, OwnTips } from '@pospay/contracts';
import {
  type PrivateViewDeadlines,
  type PrivateViewRemaining,
  touchedDeadlines,
} from './private-view-deadline';

/** سبب الرجوع لخطوة الـ PIN: PIN غلط، فشل الفتح، خروج من الواجهة أو انتهاء، أو رفض صلاحية من السيرفر. */
export type PinProblem = 'invalid' | 'failed' | 'expired' | 'refused' | null;

/** خدمات الشهر زي ما الشاشة بتعرضها، لوضع الموبايل الشخصي (react-query) وجهاز الاستقبال (المتحكم). */
export type LinesView = {
  status: 'pending' | 'ready' | 'error';
  pages: readonly OwnServiceLines[];
  error: unknown;
  fetchingMore: boolean;
  /** فشل تحميل صفحة إضافية: الصفحات المحمّلة تفضل ظاهرة والخطأ بيتعرض جنب زر التحميل (مش بدل القائمة). */
  moreError: unknown;
};

/** بيانات الشاشة المفتوحة: عايشة في الذاكرة بس ومبتتحطش في أي كاش أو تخزين. */
export type WorkData = {
  /** الشهر المطلوب، أو undefined = الشهر الحالي زي ما السيرفر بيحدده. */
  month: string | undefined;
  /** الشهر الحالي من السيرفر، لقفل زر «التالي». */
  home: string | undefined;
  lines: LinesView;
  tips: OwnTips | undefined;
  /** قراءة الإكراميات فشلت (نقل أو سيرفر)؛ غير حالة HIDDEN اللي بتخفي البلوك بقرار الصلاحيات. */
  tipsFailed: boolean;
};

export type PrivateWindowState =
  /**
   * `epoch` بيتغيّر مع كل خروج من الواجهة، والنموذج بيتركّب بيه فبيتفرّغ، والمتحكم بيرفض أي إرسال من epoch قديم.
   * `waiting` = طلب فتح لسه ما رجعش، فمفيش إرسال جديد لحد ما يرجع.
   */
  | { phase: 'pin'; problem: PinProblem; epoch: number; waiting: boolean }
  | { phase: 'opening'; epoch: number }
  | { phase: 'open'; windowId: string; deadlines: PrivateViewDeadlines; data: WorkData }
  | { phase: 'leave' };

export type PrivateWindowAction =
  | { type: 'opening' }
  | { type: 'opened'; windowId: string; deadlines: PrivateViewDeadlines }
  | { type: 'closed'; problem: PinProblem; epoch: number; waiting: boolean }
  | { type: 'settled' }
  | { type: 'left' }
  | { type: 'touched'; sentAt: number; remaining: PrivateViewRemaining }
  | { type: 'month'; month: string }
  | { type: 'retry' }
  | { type: 'linesMore' }
  | { type: 'linesLoaded'; page: OwnServiceLines; append: boolean }
  | { type: 'linesFailed'; error: unknown }
  | { type: 'tipsLoaded'; tips: OwnTips }
  | { type: 'tipsFailed' }
  | { type: 'tipsRetry' };

export const PENDING_LINES: LinesView = {
  status: 'pending',
  pages: [],
  error: undefined,
  fetchingMore: false,
  moreError: undefined,
};
const EMPTY_DATA: WorkData = {
  month: undefined,
  home: undefined,
  lines: PENDING_LINES,
  tips: undefined,
  tipsFailed: false,
};

/**
 * الشهر اللي الشاشة بتعرضه: المطلوب، أو شهر السيرفر من أول صفحة.
 *
 * @param data بيانات الشاشة المفتوحة
 * @returns الشهر بصيغة YYYY-MM أو undefined قبل أول رد
 */
export function shownMonth(data: WorkData): string | undefined {
  return data.month ?? data.lines.pages[0]?.month;
}

function reduceData(data: WorkData, action: PrivateWindowAction): WorkData {
  switch (action.type) {
    case 'month':
      return {
        ...data,
        month: action.month,
        lines: PENDING_LINES,
        tips: undefined,
        tipsFailed: false,
      };
    case 'retry':
      // الإعادة بتقرا الخدمات والإكراميات مع بعض، فالإكراميات القديمة بتتشال لحد ما الجديدة توصل (فشلها يفضّل البلوك مخفي)
      return { ...data, lines: PENDING_LINES, tips: undefined, tipsFailed: false };
    case 'linesMore':
      return { ...data, lines: { ...data.lines, fetchingMore: true, moreError: undefined } };
    case 'linesLoaded': {
      const pages = action.append ? [...data.lines.pages, action.page] : [action.page];
      const home = data.month === undefined && !action.append ? action.page.month : data.home;
      return { ...data, home, lines: { ...PENDING_LINES, status: 'ready', pages } };
    }
    case 'linesFailed':
      // فشل صفحة إضافية ما بيشيلش الصفحات اللي اتحمّلت: بيفضل الـ status جاهز والخطأ في moreError.
      return {
        ...data,
        lines: data.lines.fetchingMore
          ? { ...data.lines, fetchingMore: false, moreError: action.error }
          : { ...data.lines, status: 'error', error: action.error, fetchingMore: false },
      };
    case 'tipsLoaded': {
      // الإكراميات بتتعرض بس لو شهرها هو الشهر المعروض؛ رد شهر تاني مبيتحطش تحت عنوان شهر مختلف.
      const shown = shownMonth(data);
      if (shown !== undefined && shown !== action.tips.month) return data;
      return { ...data, tips: action.tips, tipsFailed: false };
    }
    case 'tipsFailed':
      return { ...data, tips: undefined, tipsFailed: true };
    case 'tipsRetry':
      return { ...data, tips: undefined, tipsFailed: false };
    default:
      return data;
  }
}

/**
 * انتقال حالة النافذة الخاصة: دالة صافية؛ كل فحص الجيل والموعد بيحصل في المتحكم قبل ما أي فعل يوصل هنا.
 *
 * @param state الحالة الحالية
 * @param action الفعل
 * @returns الحالة الجديدة؛ أفعال البيانات على حالة مش مفتوحة بتتجاهل
 */
export function reducePrivateWindow(
  state: PrivateWindowState,
  action: PrivateWindowAction,
): PrivateWindowState {
  switch (action.type) {
    case 'opening':
      return { phase: 'opening', epoch: state.phase === 'pin' ? state.epoch : 0 };
    case 'opened':
      return {
        phase: 'open',
        windowId: action.windowId,
        deadlines: action.deadlines,
        data: EMPTY_DATA,
      };
    case 'closed':
      return {
        phase: 'pin',
        problem: action.problem,
        epoch: action.epoch,
        waiting: action.waiting,
      };
    case 'settled':
      return state.phase === 'pin' && state.waiting ? { ...state, waiting: false } : state;
    case 'left':
      return { phase: 'leave' };
    default:
      if (state.phase !== 'open') return state;
      if (action.type === 'touched')
        return {
          ...state,
          deadlines: touchedDeadlines(state.deadlines, action.sentAt, action.remaining),
        };
      return { ...state, data: reduceData(state.data, action) };
  }
}
