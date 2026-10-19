import { createEmployeeInput, setEmployeeNumberInput } from '@pospay/contracts';
import { expect, it } from 'vitest';
import {
  createEmployeeNumberFieldOptions,
  employeeNumberFieldOptions,
  employeeNumberFieldText,
  employeeNumberResolver,
} from './employee-number-form-schema';

const resolverOptions = { fields: {}, shouldUseNativeValidation: false };

it('accepts a trimmed typed number through the contract resolver', async () => {
  const employeeNumber = employeeNumberFieldOptions.setValueAs('  007 ');
  expect(employeeNumber).toBe(7);
  expect(setEmployeeNumberInput.safeParse({ employee_number: employeeNumber }).success).toBe(true);
  await expect(
    employeeNumberResolver({ employee_number: employeeNumber }, undefined, resolverOptions),
  ).resolves.toMatchObject({ values: { employee_number: 7 }, errors: {} });
});

it('turns anything except a typed employee number into a value the contract rejects', () => {
  for (const typed of ['', '   ', '0', '007a', '1000000', 12]) {
    const employeeNumber = employeeNumberFieldOptions.setValueAs(typed);
    expect(setEmployeeNumberInput.safeParse({ employee_number: employeeNumber }).success).toBe(
      false,
    );
  }
});

it('lets a blank create field pass and refuses an unparseable one', () => {
  expect(createEmployeeNumberFieldOptions.setValueAs('   ')).toBeUndefined();
  expect(createEmployeeNumberFieldOptions.setValueAs('  007 ')).toBe(7);
  expect(createEmployeeNumberFieldOptions.setValueAs(1005)).toBe(1005);
  const invalid = createEmployeeNumberFieldOptions.setValueAs('12a');
  expect(Number.isNaN(invalid)).toBe(true);
  const base = {
    primary_branch_id: '01920000-0000-7000-8000-0000000000a2',
    name_en: 'Synthetic employee',
    role_code: 'staff' as const,
    hire_date: '2026-01-01',
  };
  expect(createEmployeeInput.safeParse(base).success).toBe(true);
  expect(createEmployeeInput.safeParse({ ...base, employee_number: 7 }).success).toBe(true);
  expect(createEmployeeInput.safeParse({ ...base, employee_number: invalid }).success).toBe(false);
});

it('shows the caller message only when the contract rejects the field', async () => {
  const employeeNumber = employeeNumberFieldOptions.setValueAs('007a');
  const resolved = await employeeNumberResolver(
    { employee_number: employeeNumber },
    undefined,
    resolverOptions,
  );
  expect(employeeNumberFieldText(resolved.errors.employee_number, 'bad')).toBe('bad');
  expect(employeeNumberFieldText(undefined, 'bad')).toBeNull();
});
