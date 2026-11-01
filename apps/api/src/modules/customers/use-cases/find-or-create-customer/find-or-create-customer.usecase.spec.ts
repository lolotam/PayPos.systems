import { describe, expect, it, vi } from 'vitest';

import type { AuditRecord } from '../../../../shared/ports/audit-trail.port.ts';
import type { CustomerRecord } from '../../domain/customer.ts';
import { InvalidCustomerProfileError } from '../../domain/errors.ts';
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

function setup(existing: CustomerRecord | null, created = true) {
  const customer: CustomerRecord = {
    id: 'existing-id',
    phone: '+12025550123',
    name: 'Stored name',
    locale: 'en',
    optedOutAt: at,
  };
  const recorded: AuditRecord[] = [];
  const auditRecord = vi.fn(async (entry: AuditRecord) => {
    recorded.push(entry);
    return undefined;
  });
  const scope: CustomerScope = {
    findByPhone: vi.fn(async () => existing),
    create: vi.fn(async () => ({ customer, created })),
    addNote: vi.fn(async () => undefined),
    branchBusiness: vi.fn(async () => 'business-of-the-branch'),
    audit: { record: auditRecord },
  };
  const transactions: CustomerTransactions = { run: vi.fn(async (_actor, work) => work(scope)) };
  const ids = { newId: vi.fn(() => 'new-id') };
  const clock = { now: vi.fn(() => at) };
  return {
    scope,
    audit: auditRecord,
    recorded,
    transactions,
    ids,
    clock,
    useCase: new FindOrCreateCustomerUseCase(transactions, ids, clock),
  };
}

describe('find-or-create customer — the creation path', () => {
  it('passes verified actor and injected time/id; audits only a created row with masked phone', async () => {
    const h = setup(null);
    const response = await h.useCase.execute({ ...actor, scope: { kind: 'company' }, input });
    expect(h.transactions.run).toHaveBeenCalledWith(
      expect.objectContaining(actor),
      expect.any(Function),
    );
    expect(h.scope.create).toHaveBeenCalledWith({
      id: 'new-id',
      name: 'New name',
      phone: '+12025550123',
      locale: 'ar',
      at,
    });
    expect(h.audit).toHaveBeenCalledWith({
      entity: 'customer',
      entityId: response.id,
      action: 'created',
      after: response,
    });
    expect(Object.keys(response)).toEqual(['id', 'name', 'locale', 'opted_out', 'phone']);
    expect(h.recorded).toHaveLength(1);
    expect(JSON.stringify(response)).not.toContain('+12025550123');
  });

  it('creates with the profile fields that were supplied and leaves the rest out', async () => {
    const h = setup(null);
    await h.useCase.execute({
      ...actor,
      scope: { kind: 'company' },
      input: {
        ...input,
        gender: 'female',
        birthday: { day: 5, month: 3, year: 1990 },
        email: 'a@b.test',
      },
    });
    expect(h.scope.create).toHaveBeenCalledWith({
      id: 'new-id',
      name: 'New name',
      phone: '+12025550123',
      locale: 'ar',
      at,
      gender: 'female',
      birthday: { day: 5, month: 3, year: 1990 },
      email: 'a@b.test',
    });
  });
});

describe('find-or-create customer — the existing customer', () => {
  it('returns stored name, locale and opt-out without writing another audit', async () => {
    const h = setup(null, false);
    expect(await h.useCase.execute({ ...actor, scope: { kind: 'company' }, input })).toEqual({
      id: 'existing-id',
      name: 'Stored name',
      locale: 'en',
      opted_out: true,
      phone: '***123',
    });
    expect(h.audit).not.toHaveBeenCalled();
  });

  it('is returned as is: no field, no note and no audit', async () => {
    const h = setup({
      id: 'existing-id',
      phone: '+12025550123',
      name: 'Stored name',
      locale: 'en',
      optedOutAt: at,
    });
    const response = await h.useCase.execute({
      ...actor,
      scope: { kind: 'business', businessId: 'business-id' },
      input: {
        ...input,
        gender: 'female',
        birthday: { day: 5, month: 3, year: 1990 },
        email: 'a@b.test',
        note: 'Prefers the window seat',
      },
    });
    expect(response).toEqual({
      id: 'existing-id',
      name: 'Stored name',
      locale: 'en',
      opted_out: true,
      phone: '***123',
    });
    expect(h.scope.create).not.toHaveBeenCalled();
    expect(h.scope.addNote).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
  });
});

describe('find-or-create customer — the notes', () => {
  it('saves the note under the business of the route', async () => {
    const h = setup(null);
    await h.useCase.execute({
      ...actor,
      scope: { kind: 'business', businessId: 'business-id' },
      input: { ...input, note: 'Prefers the window seat' },
    });
    expect(h.scope.addNote).toHaveBeenCalledWith({
      customerId: 'existing-id',
      businessId: 'business-id',
      note: 'Prefers the window seat',
      at,
    });
    expect(h.scope.branchBusiness).not.toHaveBeenCalled();
  });

  it('resolves the branch business before saving the note of the branch route', async () => {
    const h = setup(null);
    await h.useCase.execute({
      ...actor,
      scope: { kind: 'branch', branchId: 'branch-id' },
      input: { ...input, note: 'Prefers the window seat' },
    });
    expect(h.scope.branchBusiness).toHaveBeenCalledWith('branch-id');
    expect(h.scope.addNote).toHaveBeenCalledWith({
      customerId: 'existing-id',
      businessId: 'business-of-the-branch',
      note: 'Prefers the window seat',
      at,
    });
  });

  it('the loser of the race writes no note and no audit', async () => {
    const h = setup(null, false);
    await h.useCase.execute({
      ...actor,
      scope: { kind: 'business', businessId: 'business-id' },
      input: { ...input, note: 'Prefers the window seat' },
    });
    expect(h.scope.addNote).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
  });
});

describe('find-or-create customer — the refusals', () => {
  it('refuses a company command that carries a note instead of dropping it silently', async () => {
    const h = setup(null);
    const command = {
      ...actor,
      scope: { kind: 'company' as const },
      input: { ...input, note: 'Prefers the window seat' },
    };
    await expect(h.useCase.execute(command)).rejects.toThrow(InvalidCustomerProfileError);
    expect(h.transactions.run).not.toHaveBeenCalled();
  });

  it('refuses a profile that is not valid before opening a transaction', async () => {
    const h = setup(null);
    await expect(
      h.useCase.execute({
        ...actor,
        scope: { kind: 'company' },
        input: { ...input, birthday: { day: 30, month: 2 } },
      }),
    ).rejects.toThrow(InvalidCustomerProfileError);
    await expect(
      h.useCase.execute({
        ...actor,
        scope: { kind: 'company' },
        input: { ...input, email: 'not-an-email' },
      }),
    ).rejects.toThrow(InvalidCustomerProfileError);
    expect(h.transactions.run).not.toHaveBeenCalled();
  });

  it('rejects an invalid Kuwait number before opening a transaction or generating ids', async () => {
    const h = setup(null);
    await expect(
      h.useCase.execute({
        ...actor,
        scope: { kind: 'company' },
        input: { ...input, phone: { calling_code: '965', national_number: '1234567' } },
      }),
    ).rejects.toThrow(InvalidCustomerPhoneError);
    expect(h.transactions.run).not.toHaveBeenCalled();
    expect(h.ids.newId).not.toHaveBeenCalled();
  });
});
