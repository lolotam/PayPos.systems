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
};

/** بيانات الشاشة المفتوحة: عايشة في الذاكرة بس ومبتتحطش في أي كاش أو تخزين. */
export type WorkData = {
  /** الشهر المطلوب، أو undefined = الشهر الحالي زي ما السيرفر بيحدده. */
  month: string | undefined;
  /** الشهر الحالي من السيرفر، لقفل زر «التالي». */
  home: string | undefined;
  lines: LinesView;
  tips: OwnTips | undefined;
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
  | { type: 'tipsLoaded'; tips: OwnTips };

export const PENDING_LINES: LinesView = {
  status: 'pending',
  pages: [],
  error: undefined,
  fetchingMore: false,
};
const EMPTY_DATA: WorkData = {
  month: undefined,
  home: undefined,
  lines: PENDING_LINES,
  tips: undefined,
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
      return { ...data, month: action.month, lines: PENDING_LINES, tips: undefined };
    case 'retry':
      return { ...data, lines: PENDING_LINES };
    case 'linesMore':
      return { ...data, lines: { ...data.lines, fetchingMore: true } };
    case 'linesLoaded': {
      const pages = action.append ? [...data.lines.pages, action.page] : [action.page];
      const home = data.month === undefined && !action.append ? action.page.month : data.home;
      return { ...data, home, lines: { ...PENDING_LINES, status: 'ready', pages } };
    }
    case 'linesFailed':
      return {
        ...data,
        lines: { ...data.lines, status: 'error', error: action.error, fetchingMore: false },
      };
    case 'tipsLoaded':
      return { ...data, tips: action.tips };
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
