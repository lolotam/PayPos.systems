import type { AttendanceSession } from '../model/attendance-view';

/** بيانات شاشة «حضوري» داخل النافذة الخاصة: عايشة في الذاكرة بس ومبتتحطش في أي كاش. */
export type AttendanceData = {
  /** الشهر المطلوب، أو undefined = الشهر الحالي زي ما السيرفر بيحدده. */
  month: string | undefined;
  /** الشهر الحالي من السيرفر، لقفل زر «التالي». */
  home: string | undefined;
  /** جلسات الشهر المعروض. */
  sessions: AttendanceSession[];
  status: 'pending' | 'ready' | 'error';
  error: unknown;
};

/** أفعال بيانات «حضوري» (مش أفعال النافذة نفسها). */
export type AttendanceAction =
  | { type: 'month'; month: string | undefined }
  | { type: 'retry' }
  | { type: 'loaded'; month: string; sessions: AttendanceSession[] }
  | { type: 'failed'; error: unknown };

export const EMPTY_ATTENDANCE: AttendanceData = {
  month: undefined,
  home: undefined,
  sessions: [],
  status: 'pending',
  error: undefined,
};

/**
 * تقصير بيانات «حضوري» بالفعل: كل فعل بيقرّر شكل البيانات بعده (شهر جديد، إعادة محاولة، رد ناجح، فشل).
 *
 * @param data البيانات الحالية
 * @param action فعل البيانات
 * @returns البيانات الجديدة
 */
export function reduceAttendanceData(data: AttendanceData, action: AttendanceAction): AttendanceData {
  switch (action.type) {
    case 'month':
      return { ...data, month: action.month, sessions: [], status: 'pending', error: undefined };
    case 'retry':
      return { ...data, sessions: [], status: 'pending', error: undefined };
    case 'loaded':
      return {
        ...data,
        home: data.month === undefined ? action.month : data.home,
        sessions: action.sessions,
        status: 'ready',
        error: undefined,
      };
    case 'failed':
      return { ...data, status: 'error', error: action.error };
  }
}
