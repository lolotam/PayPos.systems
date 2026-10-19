/** قبل وبعد الرقم كما يُكتبان في التدقيق حتى لا يختلف الصف عن السجل. */
export interface EmployeeNumberAudit {
  before: { employee_number: number };
  after: { employee_number: number };
}

/**
 * يميز تغيير الرقم عن إبقاء نفس القيمة حتى لا يُقفل العدّاد ولا يُكتب تدقيق على طلب بلا أثر.
 * بعد 8c-11 الرقم محفوظ دائماً، فالتطابق وحده هو الذي يتخطى القفل والتدقيق.
 *
 * @param before الرقم المحفوظ
 * @param after الرقم المطلوب
 * @returns null عند التطابق، وإلا قبل وبعد للتدقيق
 */
export function employeeNumberChange(
  before: number,
  after: number,
): EmployeeNumberAudit | null {
  if (before === after) return null;
  return { before: { employee_number: before }, after: { employee_number: after } };
}
