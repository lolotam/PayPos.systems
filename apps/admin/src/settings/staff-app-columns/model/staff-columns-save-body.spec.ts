import type { StaffColumnsSettings } from '@pospay/contracts';
import { expect, it } from 'vitest';
import { staffColumnsSaveBody } from './staff-columns-save-body';

const businessId = '01920000-0000-7000-8000-0000000000a2';

function settings(overrides: Partial<StaffColumnsSettings> = {}): StaffColumnsSettings {
  return {
    business_id: businessId,
    columns: ['date', 'time', 'service'],
    columns_default: true,
    months_back: 2,
    months_back_default: true,
    ...overrides,
  };
}

it('keeps an untouched default column set on the default', () => {
  const body = staffColumnsSaveBody(settings(), {
    columns: ['date', 'time', 'service'],
    months_back: 2,
  });
  expect(body.columns).toBeNull();
  expect(body.months_back).toBeNull();
});

it('sends the column array when the default set changed', () => {
  const body = staffColumnsSaveBody(settings(), {
    columns: ['date', 'net'],
    months_back: 2,
  });
  expect(body.columns).toEqual(['date', 'net']);
});

it('sends the column array when the business already chose its own set', () => {
  const body = staffColumnsSaveBody(settings({ columns_default: false }), {
    columns: ['date', 'time', 'service'],
    months_back: 2,
  });
  expect(body.columns).toEqual(['date', 'time', 'service']);
});

it('treats a reordered but equal column set as unchanged', () => {
  const body = staffColumnsSaveBody(settings(), {
    columns: ['service', 'time', 'date'],
    months_back: 2,
  });
  expect(body.columns).toBeNull();
});

it('sends the months when the default months changed', () => {
  const body = staffColumnsSaveBody(settings(), {
    columns: ['date', 'time', 'service'],
    months_back: 4,
  });
  expect(body.months_back).toBe(4);
});

it('sends the months when the business already chose its own months', () => {
  const body = staffColumnsSaveBody(settings({ months_back_default: false, months_back: 2 }), {
    columns: ['date', 'time', 'service'],
    months_back: 2,
  });
  expect(body.months_back).toBe(2);
});
