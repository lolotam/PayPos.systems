import { zodResolver } from '@hookform/resolvers/zod';
import { setEmployeeNumberInput } from '@pospay/contracts';
import { parseEmployeeNumber } from '@pospay/domain';

/** قاعدة واحدة لكل نموذج رقم وظيفي، عشان شاشة الشركة ونموذج الموظف ما يفرّقوش. */
export const employeeNumberResolver = zodResolver(setEmployeeNumberInput);

export const employeeNumberFieldOptions = {
  setValueAs(typed: unknown): number {
    if (typeof typed !== 'string') return Number.NaN;
    return parseEmployeeNumber(typed.trim()) ?? Number.NaN;
  },
};

export function employeeNumberFieldText(error: unknown, message: string): string | null {
  return error == null ? null : message;
}
