import { expect } from 'vitest';
import { SessionError } from '../../session-error.ts';
import type { TipEntry, TipPerson } from '../../tip-set.ts';

/**
 * يبني سطر بقشيش مختصر حتى تبقى حالات الاختبار مقروءة.
 *
 * @param employee_id هوية الموظفة
 * @param method طريقة الدفع
 * @param amount المبلغ بالفلس
 * @returns سطر بقشيش
 */
export function entry(employee_id: string, method: TipEntry['method'], amount: bigint): TipEntry {
  return { employee_id, method, amount };
}

/**
 * يبني صف منفّذة؛ الغياب عن الخيارات يعني لقطة سليمة بلا ربط.
 *
 * @param employee_id هوية الموظفة
 * @param options خيارات الصف
 * @param options.active هل لها سطر فعّال
 * @param options.linked هوية اللقطة، والفارغ لا يطابق أحداً
 * @param options.current الربط الحالي، والفارغ لا يطابق أحداً
 * @param options.snapshotted هل التقطت اللقطة
 * @param options.identities صفوف هوية جاهزة عندما نحتاج أكثر من لقطة
 * @returns صف الموظفة كما تقرأه قاعدة البقشيش
 */
export function person(
  employee_id: string,
  options: {
    active?: boolean;
    linked?: string | null;
    current?: string | null;
    snapshotted?: boolean;
    identities?: TipPerson['identities'];
  } = {},
): TipPerson {
  const snapshotted = options.snapshotted ?? true;
  return {
    employee_id,
    has_active_line: options.active ?? true,
    current_user_id: options.current ?? null,
    identities: options.identities ?? [
      { linked_user_id: options.linked ?? null, linked_user_snapshotted: snapshotted },
    ],
  };
}

/**
 * يرجّع رمز الرفض حتى يقارن الاختبار الترتيب من غير تكرار الالتقاط.
 *
 * @param run الدالة المتوقع أن ترفض
 * @returns رمز SessionError
 */
export function codeOf(run: () => void): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(SessionError);
    return (error as SessionError).code;
  }
  throw new Error('expected a SessionError');
}
