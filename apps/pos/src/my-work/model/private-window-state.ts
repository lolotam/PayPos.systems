import type { OwnCommissionEstimate, OwnServiceLines, OwnTips } from '@pospay/contracts';
import {
  type PinProblem,
  type PrivateViewState,
  type PrivateViewWindowAction,
  reducePrivateView,
} from '@/private-view/state';

export type { PinProblem };

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
  /** تقدير عمولة الشهر المعروض؛ undefined = لسه ما اتحمّلش أو القراءة اترفضت، والكارت ما بيظهرش. */
  estimate: OwnCommissionEstimate | undefined;
};

export type PrivateWindowState = PrivateViewState<WorkData>;

/** أفعال بيانات «شغلي» (مش أفعال النافذة نفسها). */
export type WorkAction =
  | { type: 'month'; month: string | undefined }
  | { type: 'retry' }
  | { type: 'linesMore' }
  | { type: 'linesLoaded'; page: OwnServiceLines; append: boolean }
  | { type: 'linesFailed'; error: unknown }
  | { type: 'tipsLoaded'; tips: OwnTips }
  | { type: 'tipsFailed' }
  | { type: 'tipsRetry' }
  | { type: 'estimateLoaded'; month: string | undefined; estimate: OwnCommissionEstimate };

export type PrivateWindowAction = PrivateViewWindowAction | WorkAction;

export const PENDING_LINES: LinesView = {
  status: 'pending',
  pages: [],
  error: undefined,
  fetchingMore: false,
  moreError: undefined,
};
export const EMPTY_DATA: WorkData = {
  month: undefined,
  home: undefined,
  lines: PENDING_LINES,
  tips: undefined,
  tipsFailed: false,
  estimate: undefined,
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

/**
 * تقصير بيانات «شغلي» بالفعل: كل فعل بيقرّر شكل البيانات بعده (شهر جديد، إعادة محاولة، صفحة اتحمّلت).
 *
 * @param data البيانات الحالية
 * @param action فعل البيانات
 * @returns البيانات الجديدة
 */
export function reduceWorkData(data: WorkData, action: WorkAction): WorkData {
  switch (action.type) {
    case 'month':
      return {
        ...data,
        month: action.month,
        lines: PENDING_LINES,
        tips: undefined,
        tipsFailed: false,
        estimate: undefined,
      };
    case 'retry':
      // الإعادة بتقرا الخدمات والإكراميات مع بعض، فالإكراميات القديمة بتتشال لحد ما الجديدة توصل (فشلها يفضّل البلوك مخفي)
      return {
        ...data,
        lines: PENDING_LINES,
        tips: undefined,
        tipsFailed: false,
        estimate: undefined,
      };
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
    case 'estimateLoaded': {
      // التقدير بيتعرض بس لو شهره هو الشهر المعروض؛ رد شهر تاني مبيتحطش تحت شهر مختلف (زي الإكراميات).
      const shown = shownMonth(data);
      if (shown !== undefined && shown !== action.month) return data;
      return { ...data, estimate: action.estimate };
    }
    case 'tipsFailed':
      return { ...data, tips: undefined, tipsFailed: true };
    case 'tipsRetry':
      return { ...data, tips: undefined, tipsFailed: false };
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
    case 'opened':
    case 'closed':
    case 'settled':
    case 'left':
    case 'touched':
      return reducePrivateView(state, action, EMPTY_DATA);
    default:
      if (state.phase !== 'open') return state;
      return { ...state, data: reduceWorkData(state.data, action) };
  }
}
