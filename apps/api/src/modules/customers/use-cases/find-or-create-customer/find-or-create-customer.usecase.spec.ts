import { describe, expect, it, vi } from 'vitest';

import type {
  CustomerScope,
  CustomerTransactions,
} from '../../ports/customer-transactions.port.ts';
import {
  FindOrCreateCustomerUseCase,
  InvalidCustomerPhoneError,
} from './find-or-create-customer.usecase.ts';

const input = {
  phone: { calling_code: '1', national_number: '0002025550123' },
  name: 'New name',
  locale: 'ar' as const,
};
const actor = { companyId: 'company', userId: 'user' };
const at = new Date('2026-10-01T00:00:00Z');

function setup(created: boolean) {
  const customer = {
    id: 'existing-id',
    phone: '+12025550123',
    name: 'Stored name',
    locale: 'en' as const,
    optedOutAt: at,
  };
  const scope: CustomerScope = {
    findOrCreate: vi.fn(async () => ({ customer, created })),
    audit: { record: vi.fn(async () => undefined) },
  };
  const transactions: CustomerTransactions = { run: vi.fn(async (_actor, work) => work(scope)) };
  const ids = { newId: vi.fn(() => 'new-id') };
  const clock = { now: vi.fn(() => at) };
  return {
    scope,
    transactions,
    ids,
    clock,
    useCase: new FindOrCreateCustomerUseCase(transactions, ids, clock),
  };
}

describe('find-or-create customer orchestration', () => {
  it('passes verified actor and injected time/id; audits only a created row with masked phone', async () => {
    const h = setup(true);
    const response = await h.useCase.execute({ ...actor, input });
    expect(h.transactions.run).toHaveBeenCalledWith(
      expect.objectContaining(actor),
      expect.any(Function),
    );
    expect(h.scope.findOrCreate).toHaveBeenCalledWith({
      ...input,
      phone: '+12025550123',
      id: 'new-id',
      at,
    });
    expect(h.scope.audit.record).toHaveBeenCalledWith({
      entity: 'customer',
      entityId: response.id,
      action: 'created',
      after: response,
    });
    expect(JSON.stringify(response)).not.toContain('+12025550123');
  });

  it('returns stored name, locale and opt-out without writing another audit', async () => {
    const h = setup(false);
    expect(await h.useCase.execute({ ...actor, input })).toEqual({
      id: 'existing-id',
      name: 'Stored name',
      locale: 'en',
      opted_out: true,
      phone: '***123',
    });
    expect(h.scope.audit.record).not.toHaveBeenCalled();
  });

  it('rejects an invalid Kuwait number before opening a transaction or generating ids', async () => {
    const h = setup(true);
    await expect(
      h.useCase.execute({
        ...actor,
        input: { ...input, phone: { calling_code: '965', national_number: '1234567' } },
      }),
    ).rejects.toThrow(InvalidCustomerPhoneError);
    expect(h.transactions.run).not.toHaveBeenCalled();
    expect(h.ids.newId).not.toHaveBeenCalled();
  });
});
