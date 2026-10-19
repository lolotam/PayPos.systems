import { setEmployeeNumberInput } from '@pospay/contracts';
import { expect, it } from 'vitest';
import {
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
    expect(setEmployeeNumberInput.safeParse({ employee_number: employeeNumber }).success).toBe(false);
  }
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
