import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../../shared/errors.ts';
import type { EndMembershipOutcome } from '../../ports/end-membership.port.ts';
import { EndMembership } from './end-membership.ts';

const NOW = new Date('2026-11-25T10:00:00.000Z');
const command = { companyId: 'company-1', actorUserId: 'user-1', membershipId: 'membership-1' };

function build(outcome: EndMembershipOutcome, invalidate = vi.fn().mockResolvedValue(undefined)) {
  const calls: string[] = [];
  const end = vi.fn(async () => {
    calls.push('end');
    return outcome;
  });
  const wrapped = vi.fn(async (...args: [string, string]) => {
    calls.push('invalidate');
    return invalidate(...args);
  });
  const useCase = new EndMembership({
    transactions: { end },
    invalidator: { invalidate: wrapped },
    clock: { now: () => NOW },
  });
  return { useCase, end, wrapped, calls };
}

describe('EndMembership', () => {
  it('ends with the injected clock, then invalidates the grants, and answers id + ends_at', async () => {
    const { useCase, end, wrapped, calls } = build({
      id: 'membership-1',
      endsAt: NOW.toISOString(),
    });
    await expect(useCase.execute(command)).resolves.toEqual({
      id: 'membership-1',
      ends_at: NOW.toISOString(),
    });
    expect(end).toHaveBeenCalledWith(command, expect.any(Function));
    const readClock = (end.mock.calls[0] as unknown[] | undefined)?.[1];
    expect(typeof readClock === 'function' ? (readClock as () => Date)() : null).toBe(NOW);
    expect(wrapped).toHaveBeenCalledWith('company-1', 'membership-1');
    expect(calls).toEqual(['end', 'invalidate']);
  });

  it.each([
    ['FORBIDDEN', 403],
    ['NOT_FOUND', 404],
    ['LAST_OWNER', 409],
    ['STAFF_ACCESS_MANAGED_MEMBERSHIP', 409],
  ] as const)(
    'maps the %s refusal to an ApiError and never invalidates',
    async (refusal, status) => {
      const { useCase, wrapped } = build({ refusal });
      const error = await useCase.execute(command).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe(refusal);
      expect((error as ApiError).status).toBe(status);
      expect(wrapped).not.toHaveBeenCalled();
    },
  );

  it('still answers success when the best-effort invalidation fails', async () => {
    const { useCase } = build(
      { id: 'membership-1', endsAt: NOW.toISOString() },
      vi.fn().mockRejectedValue(new Error('redis down')),
    );
    await expect(useCase.execute(command)).resolves.toEqual({
      id: 'membership-1',
      ends_at: NOW.toISOString(),
    });
  });
});
