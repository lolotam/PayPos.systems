import { expect, it, vi } from 'vitest';

import type { DiscountPinApproverPort, DiscountDeviceScopePort } from '../../ports/discount-decision.port.ts';
import type { DecideDiscountProposalsUseCase } from '../decide-discount-proposals/decide-discount-proposals.usecase.ts';
import { DecideDiscountByPinUseCase, DiscountPinError } from './decide-discount-by-pin.usecase.ts';

const request = {
  decision: 'APPROVE' as const,
  input: {
    proposal_ids: ['proposal-1'],
    terms_hashes: ['a'.repeat(64)],
    phone: '+99900000001',
    pin: '1234',
  },
  device: { companyId: 'company-1', deviceId: 'device-1', branchId: 'branch-1' },
};

function fixture() {
  const pins = {
    verify: vi.fn(async () => ({
      kind: 'ok' as const,
      userId: 'user-1',
      pinRevision: 'revision-1',
      confirmBinding: vi.fn(async () => true),
    })),
  } as unknown as DiscountPinApproverPort;
  const scope = { businessOf: vi.fn(async () => 'business-1') } as unknown as DiscountDeviceScopePort;
  const decide = { execute: vi.fn(async () => ({ proposals: [] })) } as unknown as DecideDiscountProposalsUseCase;
  return { pins, scope, decide, useCase: new DecideDiscountByPinUseCase(pins, scope, decide) };
}

function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return [...Object.keys(record), ...Object.values(record).flatMap(keysOf)];
  }
  return [];
}

it.each([
  [{ kind: 'refused' as const }, 'PIN_INVALID'],
  [{ kind: 'locked' as const }, 'PIN_LOCKED'],
  [{ kind: 'busy' as const }, 'TOO_MANY_REQUESTS'],
])('verification outcome %j maps to DiscountPinError %s', async (outcome, code) => {
  const f = fixture();
  vi.mocked(f.pins.verify).mockResolvedValue(outcome);
  await expect(f.useCase.execute(request)).rejects.toSatisfy(
    (error: unknown) => error instanceof DiscountPinError && error.code === code,
  );
  expect(f.decide.execute).not.toHaveBeenCalled();
});

it('a verification throw maps to NOT_READY', async () => {
  const f = fixture();
  vi.mocked(f.pins.verify).mockRejectedValue(new Error('synthetic infrastructure failure'));
  await expect(f.useCase.execute(request)).rejects.toMatchObject({ code: 'NOT_READY' });
  expect(f.decide.execute).not.toHaveBeenCalled();
});

it('a missing device business maps to SessionError FORBIDDEN and never decides', async () => {
  const f = fixture();
  vi.mocked(f.scope.businessOf).mockResolvedValue(null);
  await expect(f.useCase.execute(request)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(f.decide.execute).not.toHaveBeenCalled();
});

it('the delegated decision carries the PIN channel and no phone or PIN at any depth', async () => {
  const f = fixture();
  await f.useCase.execute(request);
  const delegated = vi.mocked(f.decide.execute).mock.calls[0]?.[0];
  expect(delegated).toBeDefined();
  expect(keysOf(delegated)).not.toContain('phone');
  expect(keysOf(delegated)).not.toContain('pin');
  expect(delegated).toMatchObject({
    companyId: 'company-1',
    userId: 'user-1',
    businessId: 'business-1',
    branchId: 'branch-1',
    key: '',
    fingerprint: '',
    decision: 'APPROVE',
    input: { proposal_ids: ['proposal-1'], terms_hashes: ['a'.repeat(64)] },
    channel: {
      via: 'PIN', deviceId: 'device-1', pinRevision: 'revision-1', confirmBinding: expect.any(Function),
    },
  });
});
