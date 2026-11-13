import { expect, it } from 'vitest';
import { resolveClosedServiceRedemption, type ClosedServiceDrafts } from '../closed-service-redemption.ts';
import type { ClosedSessionService, SessionDraft } from '../session-types.ts';

const service = (id: string, closed = false): ClosedSessionService => ({
  id, name_en: `Synthetic ${id}`, name_ar: null, price: 25000n,
  rule: { kind: 'FOLLOW_PLAN' }, counts: true, revision: 1, closed,
});

const paid = (input_index: number, service_id: string): SessionDraft => ({
  input_index, service_id, price: 25000n, discount: { kind: 'AMOUNT', amount: 0n }, performers: [],
});

/** يفحص رفض الجلسة برمزه وتفاصيله، بدل ما يمسك الخطأ بإيده. */
const refusal = (
  services: readonly ClosedSessionService[],
  drafts: ClosedServiceDrafts,
  service_id: string,
): void => {
  expect(() => resolveClosedServiceRedemption(services, drafts)).toThrow(
    expect.objectContaining({ code: 'SERVICE_CLOSED', details: { service_id } }),
  );
};

it('an open service on a paid line passes and reaches the preparation without the closed mark', () => {
  const services = resolveClosedServiceRedemption([service('open')], { paid: [paid(0, 'open')] });
  expect(services).toHaveLength(1);
  expect(services[0]).toMatchObject({ id: 'open', price: 25000n });
  expect(services[0]).not.toHaveProperty('closed');
});

it('a closed service with no paid line on it passes, so a package line can redeem it', () => {
  const services = resolveClosedServiceRedemption([service('closed', true)], { paid: [] });
  expect(services.map((entry) => entry.id)).toEqual(['closed']);
});

it('a closed service on a paid line is refused with its service id', () => {
  refusal([service('closed', true)], { paid: [paid(0, 'closed')] }, 'closed');
});

it('a closed service on a paid line is refused even when the other paid lines are open', () => {
  refusal(
    [service('open'), service('closed', true)],
    { paid: [paid(0, 'open'), paid(1, 'closed')] },
    'closed',
  );
});

it('the first paid line on a closed service is the one reported, not the first closed service in the list', () => {
  const services = [service('second', true), service('first', true)];
  const drafts = { paid: [paid(0, 'first'), paid(1, 'second')] };
  refusal(services, drafts, 'first');
});
