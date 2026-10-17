import { SessionError } from './session-error.ts';
import type { TipIdentity, TipPerson } from './tip-people.ts';

/** صف منفّذة من line_performers بلا ربط حالي، حتى لا يُقرأ الربط قبل قفل الموظفة. */
export interface TipPerformerRow {
  employee_id: string;
  has_active_line: boolean;
  identities: readonly TipIdentity[];
}

/**
 * يبني صفوف TipPerson بإلحاق الربط الحالي المقروء بعد قفل الموظفات.
 * المطابقة بلا التفات لحالة الحروف، وأي هوية من الاتحاد غائبة عن القراءة تُرفض بـ TIP_IDENTITY_UNKNOWN لأن غياب الصف ليس ربطاً فارغاً.
 *
 * @param rows صفوف line_performers بلا ربط حالي
 * @param employees ناتج performers.read بعد performers.lock
 * @param involvedIds هويات الناس والمجموعة الحالية فقط؛ الموظفة المطلوبة لأول مرة بلا سطر تُرفض لاحقاً بـ TIP_EMPLOYEE_NOT_PERFORMER لا هنا
 * @returns صف لكل منفّذة بالترتيب نفسه، والربط الفارغ يبقى null
 */
export function withCurrentLinks(
  rows: readonly TipPerformerRow[],
  employees: readonly { id: string; user_id: string | null }[],
  involvedIds: readonly string[],
): TipPerson[] {
  const links = new Map(employees.map((employee) => [employee.id.toLowerCase(), employee.user_id]));
  for (const id of involvedIds) {
    if (!links.has(id.toLowerCase())) throw new SessionError('TIP_IDENTITY_UNKNOWN');
  }
  return rows.map((row) => {
    const current = links.get(row.employee_id.toLowerCase());
    if (current === undefined) throw new SessionError('TIP_IDENTITY_UNKNOWN');
    return {
      employee_id: row.employee_id,
      has_active_line: row.has_active_line,
      identities: row.identities,
      current_user_id: current,
    };
  });
}
