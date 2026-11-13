import { expect, it } from 'vitest';
import { resolveClosedServiceRedemption, type ClosedServiceDrafts } from '../closed-service-redemption.ts';
import type { SessionError } from '../session-error.ts';
import type { ClosedSessionService, PackageSessionDraft, SessionDraft } from '../session-types.ts';

const service = (id: string, closed = false): ClosedSessionService => ({
  id, name_en: `Synthetic ${id}`, name_ar: null, price: 25000n,
  rule: { kind: 'FOLLOW_PLAN' }, counts: true, revision: 1, closed,
});

const paid = (input_index: number, service_id: string): SessionDraft => ({
  input_index, service_id, price: 25000n, discount: { kind: 'AMOUNT', amount: 0n }, performers: [],
});

const packaged = (input_index: number, service_id: string): PackageSessionDraft => ({
  input_index, service_id, entitlement_id: 'entitlement', performers: [],
});

/** يرمي رفض الجلسة بدل ما يمرر، عشان يُفحص رمزه وتفاصيله. */
const refusal = (services: readonly ClosedSessionService[], drafts: ClosedServiceDrafts): SessionError => {
  try {
    resolveClosedServiceRedemption(services, drafts);
  } catch (error) {
    return error as SessionError;
  }
  throw new Error('The visit was not refused');
};

it('an open service on a paid line passes and reaches the preparation without the closed mark', () => {
  const services = resolveClosedServiceRedemption([service('open')], { paid: [paid(0, 'open')], packages: [] });
  expect(services).toHaveLength(1);
  expect(services[0]).toMatchObject({ id: 'open', price: 25000n });
  expect(services[0]).not.toHaveProperty('closed');
});

it('a closed service redeemed from a package slot passes', () => {
  const services = resolveClosedServiceRedemption([service('closed', true)], { paid: [], packages: [packaged(0, 'closed')] });
  expect(services.map((entry) => entry.id)).toEqual(['closed']);
});

it('a closed service on a paid line is refused with its service id', () => {
  const refused = refusal([service('closed', true)], { paid: [paid(0, 'closed')], packages: [] });
  expect(refused).toMatchObject({ code: 'SERVICE_CLOSED', details: { service_id: 'closed' } });
});

it('a closed service used by a package line and a paid line is refused', () => {
  const refused = refusal([service('closed', true)], {
    paid: [paid(1, 'closed')], packages: [packaged(0, 'closed')],
  });
  expect(refused).toMatchObject({ code: 'SERVICE_CLOSED', details: { service_id: 'closed' } });
});

it('the first paid line on a closed service is the one reported, not the first closed service in the list', () => {
  const services = [service('second', true), service('first', true)];
  const drafts = { paid: [paid(0, 'first'), paid(1, 'second')], packages: [] };
  expect(refusal(services, drafts)).toMatchObject({ code: 'SERVICE_CLOSED', details: { service_id: 'first' } });
});
