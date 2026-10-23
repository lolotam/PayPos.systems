import type { ReplaceStaffColumnsInput, StaffColumnsSettings } from '@pospay/contracts';
import { expect, it } from 'vitest';
import { staffColumnsSaveBody, type StaffColumnsDraft } from './staff-columns-save-body';

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

const cases: {
  name: string;
  server: Partial<StaffColumnsSettings>;
  draft: StaffColumnsDraft;
  expected: ReplaceStaffColumnsInput;
}[] = [
  {
    name: 'keeps an untouched default column set on the default',
    server: {},
    draft: { columns: ['date', 'time', 'service'], months_back: 2 },
    expected: { columns: null, months_back: null },
  },
  {
    name: 'sends the column array when the default set changed',
    server: {},
    draft: { columns: ['date', 'net'], months_back: 2 },
    expected: { columns: ['date', 'net'], months_back: null },
  },
  {
    name: 'sends the column array when the business already chose its own set',
    server: { columns_default: false },
    draft: { columns: ['date', 'time', 'service'], months_back: 2 },
    expected: { columns: ['date', 'time', 'service'], months_back: null },
  },
  {
    name: 'treats a reordered but equal column set as unchanged',
    server: {},
    draft: { columns: ['service', 'time', 'date'], months_back: 2 },
    expected: { columns: null, months_back: null },
  },
  {
    name: 'sends the months when the default months changed',
    server: {},
    draft: { columns: ['date', 'time', 'service'], months_back: 4 },
    expected: { columns: null, months_back: 4 },
  },
  {
    name: 'sends the months when the business already chose its own months',
    server: { months_back_default: false },
    draft: { columns: ['date', 'time', 'service'], months_back: 2 },
    expected: { columns: null, months_back: 2 },
  },
];

it.each(cases)('$name', ({ server, draft, expected }) => {
  expect(staffColumnsSaveBody(settings(server), draft)).toEqual(expected);
});
