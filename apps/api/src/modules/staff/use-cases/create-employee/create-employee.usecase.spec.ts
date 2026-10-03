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
    context: vi.fn(async () => ({
      businessExists: true,
      branchBusinessId: 'business',
    })),
    canLinkUser: vi.fn(async () => true),
    insert: vi.fn(async () => undefined),
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
  });
  expect(scope.insert).toHaveBeenCalledWith(result, 'injected-id');
  expect(scope.audit).toHaveBeenCalledWith(result);
  expect(scope.canLinkUser).not.toHaveBeenCalled();
});
it('refuses changed authority before reading or writing employee data', async () => {
  const { scope, useCase } = fixture();
  vi.mocked(scope.authorize).mockResolvedValue(false);
  await expect(useCase.execute(command)).rejects.toThrow('FORBIDDEN');
  expect(scope.context).not.toHaveBeenCalled();
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
  expect(scope.insert).not.toHaveBeenCalled();
  expect(scope.audit).not.toHaveBeenCalled();
});
