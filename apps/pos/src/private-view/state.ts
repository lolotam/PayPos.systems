import {
  type PrivateViewDeadlines,
  type PrivateViewRemaining,
  touchedDeadlines,
} from './deadline';

/** سبب الرجوع لخطوة الـ PIN: PIN غلط، فشل الفتح، خروج من الواجهة أو انتهاء، أو رفض صلاحية من السيرفر. */
export type PinProblem = 'invalid' | 'failed' | 'expired' | 'refused' | null;

/**
 * حالة نافذة العرض الخاص: خطوة الـ PIN، خطوة الفتح، النافذة المفتوحة وبياناتها، أو الخروج من الشاشة.
 * البيانات نفسها (اللي بتختلف من شاشة لأخرى) جاية من صاحب الشاشة.
 */
export type PrivateViewState<TData> =
  /**
   * `epoch` بيتغيّر مع كل خروج من الواجهة، والنموذج بيتركّب بيه فبيتفرّغ، والمتحكم بيرفض أي إرسال من epoch قديم.
   * `waiting` = طلب فتح لسه ما رجعش، فمفيش إرسال جديد لحد ما يرجع.
   */
  | { phase: 'pin'; problem: PinProblem; epoch: number; waiting: boolean }
  | { phase: 'opening'; epoch: number }
  | { phase: 'open'; windowId: string; deadlines: PrivateViewDeadlines; data: TData }
  | { phase: 'leave' };

/** أفعال النافذة نفسها (مش البيانات): فتح، إغلاق، لمس، أو خروج من الشاشة. */
export type PrivateViewWindowAction =
  | { type: 'opening' }
  | { type: 'opened'; windowId: string; deadlines: PrivateViewDeadlines }
  | { type: 'closed'; problem: PinProblem; epoch: number; waiting: boolean }
  | { type: 'settled' }
  | { type: 'left' }
  | { type: 'touched'; sentAt: number; remaining: PrivateViewRemaining };

/**
 * انتقال حالة النافذة: دالة صافية على مستوى النافذة نفسها، وبيانات الشاشة بتتقصّ بواحد تاني.
 *
 * @param state الحالة الحالية
 * @param action الفعل
 * @param emptyData البيانات الأولى لما تفتح النافذة
 * @returns الحالة الجديدة
 */
export function reducePrivateView<TData>(
  state: PrivateViewState<TData>,
  action: PrivateViewWindowAction,
  emptyData: TData,
): PrivateViewState<TData> {
  switch (action.type) {
    case 'opening':
      return { phase: 'opening', epoch: state.phase === 'pin' ? state.epoch : 0 };
    case 'opened':
      return {
        phase: 'open',
        windowId: action.windowId,
        deadlines: action.deadlines,
        data: emptyData,
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
    case 'touched':
      if (state.phase !== 'open') return state;
      return {
        ...state,
        deadlines: touchedDeadlines(state.deadlines, action.sentAt, action.remaining),
      };
  }
}
