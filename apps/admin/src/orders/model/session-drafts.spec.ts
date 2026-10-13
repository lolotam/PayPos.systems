import { expect, it } from 'vitest';
import { createSessionDraft, selectSessionService } from './session-drafts';

it('keeps independent row identities for duplicate services and preserves an override on reselection', () => {
  const service = { id: 'service', name_ar: null, name_en: 'Synthetic service', price: '7.125', revision: 1 };
  const first = selectSessionService(createSessionDraft('first'), service);
  const second = selectSessionService(createSessionDraft('second'), service);
  expect([first.local_id, second.local_id]).toEqual(['first', 'second']);
  expect(first.price).toBe('7.125');
  const override = { ...first, price: '0.000' };
  expect(selectSessionService(override, { ...service, price: '10.000', revision: 2 })).toBe(override);
  expect(selectSessionService(override, { ...service, id: 'other', price: '20.000' })).toMatchObject({ local_id: 'first', price: '20.000' });
  expect(createSessionDraft().local_id).not.toBe(createSessionDraft().local_id);
});
