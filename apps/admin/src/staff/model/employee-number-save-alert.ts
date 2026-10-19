import { employeeNumberFieldText } from './employee-number-form-schema';

/** خطأ الحقل يسبق ظرف السيرفر حتى يبقى تنبيه واحد للرقم. */
export function employeeNumberSaveAlert(
  fieldError: unknown,
  serverError: unknown,
  invalidMessage: string,
  serverMessage: string,
): string | null {
  const invalid = employeeNumberFieldText(fieldError, invalidMessage);
  if (invalid) return invalid;
  return serverError == null ? null : serverMessage;
}
