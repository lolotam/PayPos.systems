import { expect, it, vi } from 'vitest';
import { CreateEmployeeUseCase } from './create-employee.usecase.ts';
import type {
  EmployeeCreationScope,
  EmployeeTransactions,
} from '../../ports/employee-transactions.port.ts';

const command = {
  companyId: 'company',
  userId: 'actor',
  businessId: 'business',
  input: {
    primary_branch_id: 'branch',
    name_en: 'Synthetic',
    role_code: 'staff' as const,
    hire_date: '2026-01-01',
  },
};
function fixture() {
  const scope: EmployeeCreationScope = {
    authorize: vi.fn(async () => true),
    readCreationAccess: vi.fn(async () => true),
    context: vi.fn(async () => ({
      businessExists: true,
      branchBusinessId: 'business',
    })),
    canLinkUser: vi.fn(async () => true),
    assignEmployeeNumber: vi.fn(async () => 4),
    recheckTypedNumber: vi.fn(async () => null),
    lockCounter: vi.fn(async () => undefined),
    typedNumberTaken: vi.fn(async () => false),
    insert: vi.fn(async () => undefined),
    insertTyped: vi.fn(async () => undefined),
    audit: vi.fn(async () => undefined),
  };
  const transactions: EmployeeTransactions = { run: (_actor, work) => work(scope) };
  const useCase = new CreateEmployeeUseCase(
    transactions,
    { newId: () => 'injected-id' },
    { now: () => new Date('2026-10-03T00:00:00Z') },
  );
  return { scope, useCase };
}
it('coordinates one transaction and injected ids/time with null optionals', async () => {
  const { scope, useCase } = fixture();
  const result = await useCase.execute(command);
  expect(result).toMatchObject({
    id: 'injected-id',
    business_id: 'business',
    name_ar: null,
    user_id: null,
    contract_end: null,
    created_at: '2026-10-03T00:00:00.000Z',
    employee_number: 4,
  });
  expect(scope.insert).toHaveBeenCalledWith(
    { ...result, name_en_key: 'synthetic', name_ar_key: null },
    'injected-id',
  );
  expect(scope.audit).toHaveBeenCalledWith(result);
  expect(scope.canLinkUser).not.toHaveBeenCalled();
  expect(scope.recheckTypedNumber).not.toHaveBeenCalled();
  expect(scope.lockCounter).not.toHaveBeenCalled();
  expect(scope.insertTyped).not.toHaveBeenCalled();
});
it('refuses changed authority before reading or writing employee data', async () => {
  const { scope, useCase } = fixture();
  vi.mocked(scope.authorize).mockResolvedValue(false);
  await expect(useCase.execute(command)).rejects.toThrow('FORBIDDEN');
  expect(scope.context).not.toHaveBeenCalled();
  expect(scope.assignEmployeeNumber).not.toHaveBeenCalled();
  expect(scope.recheckTypedNumber).not.toHaveBeenCalled();
  expect(scope.insert).not.toHaveBeenCalled();
});
it('does not swallow audit failure, so the transaction can roll back', async () => {
  const { scope, useCase } = fixture();
  vi.mocked(scope.audit).mockRejectedValue(new Error('synthetic audit failure'));
  await expect(useCase.execute(command)).rejects.toThrow('synthetic audit failure');
});
it('checks link eligibility before insert/audit and refuses an unavailable user', async () => {
  const { scope, useCase } = fixture();
  vi.mocked(scope.canLinkUser).mockResolvedValue(false);
  await expect(
    useCase.execute({ ...command, input: { ...command.input, user_id: 'linked-user' } }),
  ).rejects.toThrow('EMPLOYEE_USER_LINK_UNAVAILABLE');
  expect(scope.canLinkUser).toHaveBeenCalledWith('linked-user');
  expect(scope.assignEmployeeNumber).not.toHaveBeenCalled();
  expect(scope.insert).not.toHaveBeenCalled();
  expect(scope.audit).not.toHaveBeenCalled();
});
it('does not assign a number when domain validation throws', async () => {
  const { scope, useCase } = fixture();
  await expect(
    useCase.execute({ ...command, input: { ...command.input, contract_end: '2025-12-31' } }),
  ).rejects.toThrow('EMPLOYEE_CONTRACT_END_BEFORE_HIRE');
  expect(scope.assignEmployeeNumber).not.toHaveBeenCalled();
  expect(scope.recheckTypedNumber).not.toHaveBeenCalled();
  expect(scope.insert).not.toHaveBeenCalled();
});
it('assigns the number after the user-link check and before insert', async () => {
  const order: string[] = [];
  const { scope, useCase } = fixture();
  vi.mocked(scope.authorize).mockImplementation(async () => {
    order.push('authorize');
    return true;
  });
  vi.mocked(scope.context).mockImplementation(async () => {
    order.push('context');
    return { businessExists: true, branchBusinessId: 'business' };
  });
  vi.mocked(scope.canLinkUser).mockImplementation(async () => {
    order.push('canLinkUser');
    return true;
  });
  vi.mocked(scope.assignEmployeeNumber).mockImplementation(async () => {
    order.push('assign');
    return 4;
  });
  vi.mocked(scope.insert).mockImplementation(async () => {
    order.push('insert');
  });
  vi.mocked(scope.audit).mockImplementation(async () => {
    order.push('audit');
  });
  await useCase.execute({ ...command, input: { ...command.input, user_id: 'linked-user' } });
  expect(order).toEqual(['authorize', 'context', 'canLinkUser', 'assign', 'insert', 'audit']);
});
it('stores a typed number after the permission recheck and does not assign one', async () => {
  const order: string[] = [];
  const { scope, useCase } = fixture();
  vi.mocked(scope.recheckTypedNumber).mockImplementation(async () => {
    order.push('recheck');
    return null;
  });
  vi.mocked(scope.lockCounter).mockImplementation(async () => {
    order.push('lock');
  });
  vi.mocked(scope.typedNumberTaken).mockImplementation(async () => {
    order.push('taken');
    return false;
  });
  vi.mocked(scope.insertTyped).mockImplementation(async () => {
    order.push('insertTyped');
  });
  const result = await useCase.execute({
    ...command,
    input: { ...command.input, employee_number: 50 },
  });
  expect(result.employee_number).toBe(50);
  expect(scope.assignEmployeeNumber).not.toHaveBeenCalled();
  expect(scope.insert).not.toHaveBeenCalled();
  expect(order).toEqual(['recheck', 'lock', 'taken', 'insertTyped']);
});
it('refuses a typed number before locking the counter when the recheck is denied', async () => {
  const { scope, useCase } = fixture();
  vi.mocked(scope.recheckTypedNumber).mockResolvedValue('FORBIDDEN');
  await expect(
    useCase.execute({ ...command, input: { ...command.input, employee_number: 9 } }),
  ).rejects.toThrow('FORBIDDEN');
  expect(scope.lockCounter).not.toHaveBeenCalled();
  expect(scope.assignEmployeeNumber).not.toHaveBeenCalled();
  expect(scope.insertTyped).not.toHaveBeenCalled();
});
it('refuses a taken typed number without assigning or inserting', async () => {
  const { scope, useCase } = fixture();
  vi.mocked(scope.typedNumberTaken).mockResolvedValue(true);
  await expect(
    useCase.execute({ ...command, input: { ...command.input, employee_number: 9 } }),
  ).rejects.toThrow('EMPLOYEE_NUMBER_TAKEN');
  expect(scope.lockCounter).toHaveBeenCalledOnce();
  expect(scope.assignEmployeeNumber).not.toHaveBeenCalled();
  expect(scope.insertTyped).not.toHaveBeenCalled();
});
it('does not recheck a typed number when domain validation throws', async () => {
  const { scope, useCase } = fixture();
  await expect(
    useCase.execute({
      ...command,
      input: { ...command.input, employee_number: 9, contract_end: '2025-12-31' },
    }),
  ).rejects.toThrow('EMPLOYEE_CONTRACT_END_BEFORE_HIRE');
  expect(scope.recheckTypedNumber).not.toHaveBeenCalled();
  expect(scope.lockCounter).not.toHaveBeenCalled();
});
