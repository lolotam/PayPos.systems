import type { CreateEmployeeInput } from '@pospay/contracts';
import { parseEmployeeNumber } from '@pospay/domain';

/** فاضي بعد القص يعني ترقيم تلقائي؛ أي نص غير صالح يبقى null حتى لا يُرسل. */
export function typedEmployeeNumber(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) return undefined;
  return parseEmployeeNumber(trimmed);
}

export function withEmployeeNumber(
  values: CreateEmployeeInput,
  employeeNumber: number | undefined,
): CreateEmployeeInput {
  const next = { ...values };
  delete next.employee_number;
  if (employeeNumber !== undefined) next.employee_number = employeeNumber;
  return next;
}

export function isEmployeeNumberRefusal(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  return error.code === 'EMPLOYEE_NUMBER_TAKEN' || error.code === 'FORBIDDEN';
}
