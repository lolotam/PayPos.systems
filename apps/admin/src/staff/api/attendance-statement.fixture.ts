import { boardId, boardScope } from './attendance-board.fixture';

export const statementScope = { ...boardScope };
export const statementRenderId = '01920000-0000-7000-8000-0000000000c1';
export const statementMonth = '2026-10';

export const statementShifts = {
  shifts: [
    { start: '09:00', end: '20:00' },
    { start: '08:00', end: '16:00' },
  ],
};

/**
 * موظفة تغطيتها وردية جدولة بس: من غير بصمة ولا عقد، وبتظهر في المنتقي
 * لأن مسار كشف الحضور بيرجّعها بالتغطية دي.
 */
export const statementScheduleOnlyEmployee = {
  employee_id: '01920000-0000-7000-8000-0000000000c3',
  name_ar: null,
  name_en: 'Schedule only employee',
  employee_number: 17,
};

/**
 * موظفات الفرع في الفترة زي ما مسار كشف الحضور بيرجّعها: مرشحو تقرير 27b
 * والموظفات المجدول بس، مرتبين برقم الموظفة.
 */
export const statementEmployees = {
  employees: [
    { employee_id: boardId, name_ar: null, name_en: 'Synthetic employee', employee_number: 15 },
    {
      employee_id: '01920000-0000-7000-8000-0000000000c2',
      name_ar: null,
      name_en: 'Other synthetic employee',
      employee_number: 16,
    },
    statementScheduleOnlyEmployee,
  ],
};

export const statementReady = { state: 'READY' } as const;
export const statementQueued = { state: 'QUEUED' } as const;
export const statementFailed = { state: 'FAILED', error_code: 'STATEMENT_EMPTY' } as const;
